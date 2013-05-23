var log = require('./log'),
    mkdirp = require('mkdirp').sync,
    rimraf = require('rimraf').sync,

    // for asynch testing
    testQueue = [],

    collectedFailures = [],
    collectedResults = [],
    collectedJUnitXML = [],
    collectedCoverage = {};


function preProcessor() {
    rimraf(coverageDir);
    mkdirp(coverageDir);

    rimraf(resultsDir);
    mkdirp(resultsDir);
}

/**
 * Collects the failure, for use later by processResults().
 * @param {string} suiteName Where the error occurred.
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

    log.info('passed %d, failed %d, errs %d, skipped %d', results.passed, results.failed, results.errors, results.ignored);
    return;

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


function testsInY(tests, YUI, TestRunner, cb) {

    var YUIInst,
        suiteName = '';

    function handleEvent(event) {
        switch (event.type) {
        case TestRunner.BEGIN_EVENT:
            //preProcessor();
            break;

        case TestRunner.TEST_SUITE_BEGIN_EVENT:
            suiteName = event.testSuite.name;
            break;

        case TestRunner.TEST_FAIL_EVENT:
            collectFailure(suiteName, event);
            break;

        case TestRunner.COMPLETE_EVENT:
            TestRunner.unsubscribe(TestRunner.BEGIN_EVENT, handleEvent);
            TestRunner.unsubscribe(TestRunner.TEST_SUITE_BEGIN_EVENT, handleEvent);
            TestRunner.unsubscribe(TestRunner.TEST_FAIL_EVENT, handleEvent);
            TestRunner.unsubscribe(TestRunner.COMPLETE_EVENT, handleEvent);

            collectRunResults(event.results);

            if (cb) {
                cb();
            } else {
                //processResults();
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

/**
 * Add ability to skip tests without breaking.
 */
// YUITest.Assert.skip = function() {
//     YUITest.Assert._increment();
// };

module.exports = testsInY;
