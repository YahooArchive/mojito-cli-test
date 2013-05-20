/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

// todo: refactor
/*jslint anon:true, regexp:true, nomen:true, stupid:true, node:true*/
'use strict';

var libpath = require('path'),
    libfs = require('fs'),
    existsSync = libfs.existsSync || libpath.existsSync,
    exec = require('child_process').exec,
    os = require('os'),

    mkdirp = require('mkdirp').sync,
    rimraf = require('rimraf').sync,
    utils = require('./lib/utils'),
    log = require('./lib/log'),

    // paths
    BASE, // = libpath.resolve(__dirname, '../../..') + '/',
    mojitoTmp, // = '/tmp/mojitotmp',
    mojitoInstrumentedDir, // = '/tmp/mojito-lib-inst',
    resultsDir, // = 'artifacts/test',
    resultsFile, // = 'artifacts/test/result.xml',
    coverageDir, // = 'artifacts/test/coverage',
    coverageFile, // = coverageDir + '/coverage.json',
    ytcJar = require.resolve('yuitest-coverage/jar/yuitest-coverage.jar'),
    ytcrJar = require.resolve('yuitest-coverage/jar/yuitest-coverage-report.jar'),

    ymc = require('./lib/yui-module-configurator'),

    Store, // = require(BASE + 'lib/store'),

    MODE_ALL = parseInt('777', 8),
    RX_TESTS = /-tests$/,
    NO_TTY = !process.stdout.isTTY || !process.stderr.isTTY,

    /* jshint -W079*/// suppress lint "Redefinition of 'YUI'." on next line
    YUI = require('yui').YUI,
    YUITest = require('yuitest').YUITest,
    TestRunner = YUITest.TestRunner,

    // for asynch testing
    testQueue = [],

    collectedFailures = [],
    collectedResults = [],
    collectedJUnitXML = [],
    collectedCoverage = {},

    usage,
    inputOptions;


/**
 * Collects the failure, for use later by processResults().
 *
 * @param {string} suiteName The name of the test suite in which the error
 *     occurred.
 * @param {Object} event YUITest The failure event.
 */
function collectFailure(suiteName, event) {
    collectedFailures.push({
        suiteName: suiteName,
        caseName: event.testCase.name,
        testName: event.testName,
        message: event.error.getMessage(),
        stack: event.error.stack
    });
}

/**
 * Collects the results of each run, for use later by processResults().
 * This not only stores the passed results, but also digs into the TestRunner
 * global to pull out the XML (and coverage info, if we're running coverage).
 *
 * @param {Object} results The results of the test run.
 */
function collectRunResults(results) {
    var str,
        json,
        file;

    collectedResults.push(results);
    collectedJUnitXML.push(TestRunner.getResults(YUITest.TestFormat.JUnitXML));

    if (inputOptions.coverage) {
        str = TestRunner.getCoverage(YUITest.CoverageFormat.JSON);
        try {
            json = JSON.parse(str);
        } catch (e) {
            // not expected to happen very often, so no effort to make it pretty
            log.error('------ERROR------');
            log.error(e);
        }
        for (file in json) {
            if (json.hasOwnProperty(file)) {
                collectedCoverage[file] = json[file];
            }
        }
    }
}

function configureYUI(YUI, store) {
    var config = store.yui.getModulesConfig('server');
    config.useSync = true;
    YUI.applyConfig(config);
}

function colorFactory(code) {
    function color(code, string) {
        return '\u001b[' + code + 'm' + string + '\u001b[0m';
    }
    return function(string) {
        return NO_TTY ? string : color(code, string);
    };
}

/**
 * Pretty-prints the results to the console.
 *
 * @param {Array} results The results of all test runs.
 * @param {Array} allFailures The list of failure details.
 */
function consoleTestReport(results, allFailures) {
    var passedCnt = 0,
        failedCnt = 0,
        deferredCnt = 0,
        totalCnt = 0,
        percentagePassed,
        formatter = null,
        msg = '',
        failure,
        testSuiteResults = {},
        i = 0,
        r,
        report = '',
        f = {
            bold: colorFactory(1),
            red: colorFactory(31),
            green: colorFactory(32),
            yellow: colorFactory(33),
            blue: colorFactory(34)
        };

    console.log('\n');

    function printTestResults(test, suiteName, caseName) {
        totalCnt += 1;
        if (test.result === 'pass') {
            if (test.name.indexOf('TODO') > -1) {
                formatter = f.yellow;
                msg = '⚑ deferred';
                deferredCnt += 1;
            } else {
                formatter = f.green;
                msg = '✔  passed';
                passedCnt += 1;
            }
        } else {
            formatter = f.red;
            msg = '✖  FAILED';
            failedCnt += 1;
        }
        console.log(formatter(msg + '\t' + suiteName + ' :: ' + caseName +
            ' :: ' + test.name));
    }

    function printTestCaseResults(tcase, suiteName) {
        var testName;
        for (testName in tcase) {
            if (tcase.hasOwnProperty(testName)) {
                if (typeof tcase[testName] === 'object') {
                    printTestResults(tcase[testName], suiteName, tcase.name);
                }
            }
        }
    }

    function printTestSuiteResults(suite) {
        log.debug('suite: ' + suite.name);

        var caseName,
            testThing;
        testSuiteResults[suite.name] = suite;
        for (caseName in suite) {
            if (suite.hasOwnProperty(caseName)) {
                if (typeof suite[caseName] === 'object') {
                    testThing = suite[caseName];
                    if (testThing.type === 'testcase') {
                        printTestCaseResults(testThing, suite.name);
                    } else if (testThing.type === 'testsuite') {
                        printTestSuiteResults(testThing);
                    }
                }
            }
        }
    }

    for (r = 0; r < results.length; r += 1) {
        printTestSuiteResults(results[r]);
    }

    if (allFailures.length) {
        console.log('\n' + f.bold('FAILURE DETAILS:\n================'));
        for (i = 0; i < allFailures.length; i += 1) {
            failure = allFailures[i];
            // suite, case, test, details
            console.log(f.red(failure.suiteName + ' :: ' + failure.caseName +
                ' :: ' + failure.testName + '\n' +
                (failure.stack || failure.message)) + '\n');
        }
    }

    percentagePassed = Math.round(passedCnt / totalCnt * 100);

    formatter = f.green;
    report = '\nTotal tests: ' + totalCnt + '\t' + '✔ Passed: ' + passedCnt +
        '\t';
    if (deferredCnt) {
        formatter = f.yellow;
    }
    report = report + formatter('⚑ Deferred: ' + deferredCnt) + '\t';
    if (failedCnt) {
        formatter = f.red;
    } else {
        formatter = f.green;
    }
    report = report + formatter('✖ Failed: ' + failedCnt) + '\t';

    if (percentagePassed > 99) {
        formatter = f.green;
    }
    report = report + formatter(percentagePassed + '% pass rate') + '\n';

    log.info(report);

}

function preProcessor() {

    var filepath,
        fstat,
        files,
        i;

    try {
        files = libfs.readdirSync(coverageDir);
        for (i = 0; i < files.length; i += 1) {
            filepath = coverageDir + '/' + files[i];
            fstat = libfs.statSync(filepath);
            if (fstat.isFile()) {
                libfs.unlinkSync(filepath);
            }
        }
        libfs.rmdirSync(coverageDir);
    } catch (err1) {  // ignore
    }

    try {
        files = libfs.readdirSync(resultsDir);
        for (i = 0; i < files.length; i += 1) {
            filepath = resultsDir + '/' + files[i];
            fstat = libfs.statSync(filepath);
            if (fstat.isFile()) {
                libfs.unlinkSync(filepath);
            }
        }

        rimraf(resultsDir);

    } catch (err2) {  // ignore
    }

    try {
        libfs.mkdirSync(resultsDir, MODE_ALL);
    } catch (err3) {
        console.log('Couldn\'t create results dir: ' + err3);
    }

    if (inputOptions.coverage) {
        try {
            libfs.mkdirSync(coverageDir, MODE_ALL);
        } catch (err4) {
            console.log('Couldn\'t create results coverage dir: ' + err4);
        }
    }
}

/**
 * Merges results of the multiple runs.
 * Generates reports.
 * Prints output.
 */
function processResults() {
    var i,
        item,
        mergedJUnitXML,
        coverageResult,
        exitCode = 0;

    console.log();

    // merge JUnit XML
    mergedJUnitXML = '<?xml version="1.0" encoding="UTF-8"?><testsuites>';
    for (i = 0; i < collectedJUnitXML.length; i += 1) {
        item = collectedJUnitXML[i];
        item = item.replace(
            /^<\?xml version="1\.0" encoding="UTF-8"\?><testsuites>/,
            ''
        );
        item = item.replace(/<\/testsuites>$/, '');
        mergedJUnitXML += item;
    }
    mergedJUnitXML += '</testsuites>';
    log.info('Test Results:\n' + libpath.normalize(resultsFile));
    libfs.writeFileSync(resultsFile, mergedJUnitXML, 'utf8');

    consoleTestReport(collectedResults, collectedFailures);
    if (collectedFailures.length) {
        exitCode = 1;
    }

    if (inputOptions.coverage) {
        coverageResult = JSON.stringify(collectedCoverage);
        libfs.writeFileSync(coverageFile, coverageResult, 'utf8');
        log.info('Creating coverage report...');
        // generate coverage reports in html
        exec(['java -jar', ytcrJar, '--format LCOV -o', coverageDir,
            coverageFile].join(' '),
            function(error, stdout, stderr) {
                log.debug('stdout: ' + stdout);
                log.debug('stderr: ' + stderr);

                if (error !== null) {
                    log.error('exec error: ' + error);
                    process.exit(2);
                } else {
                    log.info('Test Coverage Report:\n' +
                        libpath.normalize(coverageDir +
                            '/lcov-report/index.html'));
                    // clear the old coverage reports
                    rimraf(mojitoTmp);
                    rimraf(mojitoInstrumentedDir);
                    process.exit(exitCode);
                }
            });
    } else {
        process.exit(exitCode);
    }

}

function executeTestsWithinY(tests, cb) {

    var YUIInst,
        suiteName = '';

    function handleEvent(event) {
        switch (event.type) {
        case TestRunner.BEGIN_EVENT:
            preProcessor();
            break;

        case TestRunner.TEST_SUITE_BEGIN_EVENT:
            suiteName = event.testSuite.name;
            break;

        case TestRunner.TEST_FAIL_EVENT:
            collectFailure(suiteName, event);
            break;

        case TestRunner.COMPLETE_EVENT:
            TestRunner.unsubscribe(TestRunner.BEGIN_EVENT, handleEvent);
            TestRunner.unsubscribe(TestRunner.TEST_SUITE_BEGIN_EVENT,
                handleEvent);
            TestRunner.unsubscribe(TestRunner.TEST_FAIL_EVENT, handleEvent);
            TestRunner.unsubscribe(TestRunner.COMPLETE_EVENT, handleEvent);

            collectRunResults(event.results);

            if (cb) {
                cb();
            } else {
                processResults();
            }
            break;
        }
    }

    function testRunner(Y) {
        /*jshint unused:false*/
        TestRunner.subscribe(TestRunner.BEGIN_EVENT, handleEvent);
        TestRunner.subscribe(TestRunner.TEST_SUITE_BEGIN_EVENT, handleEvent);
        TestRunner.subscribe(TestRunner.TEST_FAIL_EVENT, handleEvent);
        TestRunner.subscribe(TestRunner.COMPLETE_EVENT, handleEvent);
        TestRunner.run();
    }

    tests.push(testRunner);

    // Since TestRunner is a global, it will hang onto tests from previous
    // calls to executeTestsWithinY(), and re-run them each time.
    TestRunner.clear();

    // create new YUI instance using tests and mojito
    YUIInst = YUI({core: [
        'get',
        'features',
        'intl-base',
        'mojito'
    ]});

    YUIInst.use.apply(YUIInst, tests);
}

function instrumentDirectory(from, verbose, testType, callback) {
    log.info('Instrumenting "' + from + '" for test coverage\n\t(this will take a while).');

    var opts = verbose ? ' -v' : '',
        realPathFrom = libfs.realpathSync(from),
        cmd = 'java -jar ' + ytcJar + ' ' + opts +
            ' -d -o ' + mojitoInstrumentedDir + ' ' + mojitoTmp,
        allMatcher,
        instrumentableJsMatcher;

    rimraf(mojitoTmp);
    rimraf(mojitoInstrumentedDir);

    log.debug('copying ' + realPathFrom + ' to ' + mojitoTmp);

    if (testType === 'app') { //copy everything to instrumented dir first
        allMatcher = utils.getExclusionMatcher([
            { pattern: /\.svn/, include: false },
            { pattern: /.*/, include: true }
        ], false);
        utils.copyUsingMatcher(realPathFrom, mojitoInstrumentedDir, allMatcher);
    }

    // create a matcher that will match only the JS files that need to be
    // instrumented
    instrumentableJsMatcher = utils.getExclusionMatcher(
        [
            /\barchetypes$/,
            /\bassets$/,
            /\.svn/,
            /-tests.js$/,
            /\btests\/harness$/,
            /\byuidoc$/,
            /\btests$/,
            /server\/management$/,
            { pattern: /\.js$/, include: true },
            { pattern: /\.json$/, include: true }, //needed for framework tests
            { pattern: /\/node_modules$/, include: false },
            // match all remaining directories for correct recursion
            { pattern: /.*/, type: 'dir', include: true }
        ],
        true
    ); //exclude stuff by default

    utils.copyUsingMatcher(realPathFrom, mojitoTmp, instrumentableJsMatcher);

    log.debug(cmd);

    exec(cmd, function(error, stdout, stderr) {
        log.debug('coverage instrumentation finished for ' + mojitoInstrumentedDir);
        log.debug('stdout: ' + stdout);
        log.debug('stderr: ' + stderr);

        if (error !== null) {
            log.warn('exec error: ' + error);
        } else {
            log.debug('Copy other files for testing');
            callback();
        }
    });
}

function runTests(opts) {

    var i,
        ttn,
        targetTests,
        testName = opts.name,
        testType = opts.type || 'app',
        path = libpath.resolve(opts.path),
        coverage = inputOptions.coverage,
        verbose = inputOptions.verbose,
        store,
        testRunner,
        runNext,

        testModuleNames = ['mojito', 'mojito-test'];

    testRunner = function(testPath) {
        var testConfigs,
            sourceConfigs;

        if (testType === 'mojit') {
            testConfigs = ymc(path);
            sourceConfigs = ymc(testPath, [/-tests.js$/]);
            // clobbering the original sources with instrumented sources
            Object.keys(sourceConfigs).forEach(function(k) {
                testConfigs[k] = sourceConfigs[k];
            });
            testConfigs['mojito-test'] = {
                fullpath: libpath.join(BASE, 'lib/app/autoload/mojito-test.common.js'),
                requires: ['mojito']
            };
            testConfigs.mojito = {
                fullpath: libpath.join(BASE, 'lib/app/autoload/mojito.common.js')
            };
            YUI.applyConfig({
                modules: testConfigs
            });
        } else {
            store = Store.createStore({
                root: testPath,
                context: {},
                appConfig: { env: 'test' }
            });

            configureYUI(YUI, store);

            if (testType === 'app') {
                testConfigs = store.yui.getModulesConfig('server').modules;
            }
        }

        // allowing multiple test names to be given
        if (testName) {
            targetTests = testName.indexOf(',') > 0 ?
                    testName.split(',') :
                    [testName];
        }

        Object.keys(testConfigs).forEach(function(name) {
            // if a test name filter is in effect, only run matching tests
            if (testName) {

                for (i = 0; i < targetTests.length; i += 1) {
                    ttn = targetTests[i];
                    if (ttn === name || ttn + '-tests' === name) {
                        testModuleNames.push(name);
                    }
                }

            } else if (RX_TESTS.test(name)) {
                testModuleNames.push(name);
            }
        });

        if (!testModuleNames.length) {
            log.error('No ' + testType + ' tests to run in ' + path +
                ' with test name \'' + testName + '\'', null, true);
        }

        global.YUITest = YUITest;

        // ensures all tests are run in the same order on any machine
        testModuleNames = testModuleNames.sort();

        if (testType === 'app') {

            // execute each test within new sandbox
            testModuleNames.forEach(function(name) {
                // only run tests, and not the frame mojit tests
                if (RX_TESTS.test(name) && name !== 'HTMLFrameMojit-tests') {
                    testQueue.push(name);
                }
            });

            runNext = function() {
                var cb = runNext,
                    next = testQueue.pop();

                // only run next if there is a next
                if (testQueue.length === 0) {
                    cb = null;
                }
                executeTestsWithinY([next, 'mojito-test'], cb);
            };

            if (testQueue.length) {
                runNext();
            }

        } else {
            executeTestsWithinY(testModuleNames);
        }

    };

    if (coverage) {
        instrumentDirectory(path, verbose, testType, function() {
            testRunner(mojitoInstrumentedDir);
        });
    } else {
        testRunner(path);
    }

}

function main(env, cb) {
    var type = env.args.shift() || 'app',
        source = env.args.shift() || '.',
        dest = env.opts.directory || 'artifacts/test',
        testnames = env.args.shift() || '', // comma seperated test names
        temp = env.opts.tmpdir || os.tmpdir(); // only for coverage

    if (env.opts.verbose && !env.opts.loglevel) { // BC
        env.opts.loglevel = 'debug';
    }

    if (env.opts.loglevel) {
        log.level = env.opts.loglevel;
        log.silly('logging level set to', env.opts.loglevel);
    }

    if (!env.app) {
        cb('Must run in an application directory.');
        return;
    }

    if (!env.mojito) {
        cb('Mojito must be installed locally. Please try `npm i mojito`');
        return;
    }

    if (('app' !== type) && ('mojit' !== type)) {
        cb('Invalid test type ' + type);
        return;
    }

    // source
    if ('mojit' === type.toLowerCase()) {
        source = utils.findInPaths(['mojits', '.'], source);
        if (!source) {
            cb('Could not find mojit.');
            return;
        }
    }
    if (!source || !existsSync(source)) {
        cb('Invalid source directory.');
        return;
    }

    // dest
    if (existsSync(dest)) {
        rimraf(dest);
    }
    mkdirp(dest);

    // todo: don't do this
    BASE = env.mojito.path;
    mojitoTmp = libpath.resolve(temp, 'mojitotmp');
    mojitoInstrumentedDir = libpath.resolve(temp, 'mojitoinst');
    resultsDir = dest;
    resultsFile = libpath.join(dest, 'result.xml');
    coverageDir = libpath.join(dest, 'coverage');
    coverageFile = libpath.join(coverageDir, 'coverage.json');

    Store = require(libpath.join(env.mojito.path, 'lib/store'));
    inputOptions = env.opts;

    log.debug('type:', type);
    log.debug('testnames:', testnames);
    log.debug('source:', source);
    log.debug('dest:', dest);
    log.debug('temp:', temp);

    runTests({
        name: testnames,
        type: type,
        path: source
    });
}

/**
 * Add ability to skip tests without breaking.
 */
YUITest.Assert.skip = function() {
    YUITest.Assert._increment();
};

module.exports = main;

module.exports.usage = usage = [
    'Usage: mojito test [options] [type] [path]',
    'Options:',
    '  -d --directory Specify a destination directory besides "artifacts/test"',
    '  -c --coverage  Instruments code under test and prints coverage report',
    '  -v --verbose   Verbose logging',
    '     --debug     Same as --versbose',
    '  -t --tempdir   Specify the temporary directory to use for coverage',
    'Examples:',
    '  To test a mojit:',
    '    mojito test mojit ./path/to/mojit',
    '  To test a Mojito app:',
    '    mojito test app .',
    ''
].join('\n');

module.exports.options = [
    {shortName: 'c', hasValue: false, longName: 'coverage'},
    {shortName: 'd', hasValue: true,  longName: 'directory'},
    {shortName: 't', hasValue: true,  longName: 'tmpdir'},
    {shortName: 'v', hasValue: false, longName: 'verbose'}
];
