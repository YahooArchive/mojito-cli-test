/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

// todo: refactor
'use strict';

var libpath = require('path'),
    libfs = require('fs'),
    existsSync = libfs.existsSync,
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

    // yui module names must match this regex to be considered a test (except
    // if user specifies --testname, in which case only --testname modules run)
    RX_TESTS = /-tests$/,

    // if a test case name matches this regex, mark it "deferred"
    RX_DEFER = /^(todo|skip|ignore)\b/i,

    NO_TTY = !process.stdout.isTTY || !process.stderr.isTTY,

    /* jshint -W079*/// suppress lint "Redefinition of 'YUI'." on next line
    YUI = require('yui').YUI,
    YUITest = require('yuitest').YUITest,
    TestRunner = YUITest.TestRunner,

    collectedFailures = [],
    collectedResults = [],
    collectedJUnitXML = [],
    collectedCoverage = {},

    callback,
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
    var json,
        file;

    collectedResults.push(results);
    collectedJUnitXML.push(TestRunner.getResults(YUITest.TestFormat.JUnitXML));

    if (inputOptions.coverage) {
        json = JSON.parse(TestRunner.getCoverage(YUITest.CoverageFormat.JSON));
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

function getTmpDir() {
    // BC - os.tmpdir not implemented in SD's node 0.8 env?
    return os.tmpdir ? os.tmpdir() : '/tmp';
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

        if ((test.result === 'ignore') || test.name.match(RX_DEFER)) {
            formatter = f.yellow;
            msg = '⚑ deferred';
            deferredCnt += 1;

        } else if (test.result === 'pass') {
            formatter = f.green;
            msg = '✔  passed';
            passedCnt += 1;

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

    console.log(report);
}

function preProcessor() {
    rimraf(coverageDir);
    mkdirp(coverageDir);
    rimraf(resultsDir);
    mkdirp(resultsDir);
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
        coverageResult;

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

    function exit(code) {
        if (code) {
            callback('Failed.', null);
        } else {
            callback(null, 'Passed.');
            process.exit(0); // some tests may leave things running.
        }
    }

    if (inputOptions.coverage) {
        mkdirp(coverageDir);
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
                    // was process.exit(2);
                    callback('Failed processing coverage report');
                } else {
                    log.info('Test Coverage Report:\n' +
                        libpath.normalize(coverageDir +
                            '/lcov-report/index.html'));
                    // clear the old coverage reports
                    rimraf(mojitoTmp);
                    rimraf(mojitoInstrumentedDir);
                    exit(collectedFailures.length);
                }
            });
    } else {
        exit(collectedFailures.length);
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

function execTestQueueInY(queue) {
    var modules = [queue.pop(), 'mojito', 'mojito-test'];

    executeTestsWithinY(modules, queue.length && function execNext() {
        execTestQueueInY(queue);
    });
}

function instrumentDirectory(from, verbose, testType, cb) {
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
            { pattern: /node_modules/, include: false },
            { pattern: /\.git/, include: false },
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
            cb();
        }
    });
}

function runTests(opts) {

    var i,
        ttn,
        targetTests = opts.testlist,
        testType = opts.type,
        path = libpath.resolve(opts.path),
        coverage = inputOptions.coverage,
        verbose = inputOptions.verbose,
        store,
        testModuleNames = [];

    function testRunner(testPath) {
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
                appConfig: { env: 'test',
                    resourceStore: {
                        lazyLangs: false,
                        lazyMojits: false
                    }
                }
            });

            configureYUI(YUI, store);
            testConfigs = store.yui.getModulesConfig('server').modules;
        }

        Object.keys(testConfigs).forEach(function(name) {
            // if a test name filter is in effect, only run matching tests
            if (targetTests.length) {
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
            callback('No ' + testType + ' tests found');
            return;
        }

        global.YUITest = YUITest;

        // ensures all tests are run in the same order on any machine
        testModuleNames = testModuleNames.sort();

        if (testType === 'app') {
            execTestQueueInY(testModuleNames);
        } else {
            executeTestsWithinY(testModuleNames);
        }
    }

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
        dest = env.opts.directory || 'artifacts/test',
        temp = env.opts.tmpdir || getTmpDir(), // only used for coverage
        list = env.opts.testname, // array of optional test module names
        source = env.args.shift() || env.cwd;

    if (!list) {
        // BC 3rd arg was comma separated list of test module names
        list = env.args.length ? env.args.shift().split(',') : [];
    }

    if (env.opts.verbose && !env.opts.loglevel) { // BC
        env.opts.loglevel = 'debug';
    }

    if (env.opts.loglevel) {
        log.level = env.opts.loglevel;
        log.silly('logging level set to', env.opts.loglevel);
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
    callback = cb;

    log.debug('type:', type);
    log.debug('test module list:', list);
    log.debug('source:', source);
    log.debug('dest:', dest);
    log.debug('temp:', temp);

    runTests({
        testlist: list,
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
    'Usage: mojito test [options] [app|mojit] [path]',
    '',
    'Options:',
    '  -d --directory Specify a destination directory besides "artifacts/test"',
    '  -c --coverage  Instruments code under test and prints coverage report',
    '  -v --verbose   Verbose logging',
    '     --debug     Same as --verbose',
    '  -t --testname  name of a YUI module to restrict testing to. Repeatable.',
    '     --tempdir   Specify the temporary directory to use for coverage',
    '',
    'Examples:',
    '  To run tests for a mojit:',
    '    mojito test mojit path/to/mojit',
    '',
    '  To run tests for a Mojito app:',
    '    mojito test app',
    ''
].join(os.EOL);

module.exports.options = [
    {shortName: 'c', hasValue: false, longName: 'coverage'},
    {shortName: 'd', hasValue: true,  longName: 'directory'},
    {shortName: null, hasValue: true, longName: 'tmpdir'},
    {shortName: 't', hasValue: [String, Array], longName: 'testname'},
    {shortName: 'v', hasValue: false, longName: 'verbose'}
];
