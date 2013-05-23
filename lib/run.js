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
    return;
    rimraf(coverageDir);
    mkdirp(coverageDir);
    rimraf(resultsDir);
    mkdirp(resultsDir);
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

    log.debug('processResults...');
    return;

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


function executeTestsWithinY(tests, YUI, T, cb) {
    var Yinst, suiteName = '';

    function onbegin(event) {
        suiteName = event.testSuite.name;
    }

    /**
     * Collects the failure, for use later by processResults().
     * @param {object} event YUITest failure event.
     */
    function onfail(event) {
        collectedFailures.push({
            suiteName: suiteName,
            caseName: event.testCase.name,
            testName: event.testName,
            message: event.error.getMessage(),
            stack: event.error.stack
        });
    }

    function oncomplete(event) {
        T.unsubscribe(T.BEGIN_EVENT, preProcessor);
        T.unsubscribe(T.TEST_SUITE_BEGIN_EVENT, onbegin);
        T.unsubscribe(T.TEST_FAIL_EVENT, onfail);
        T.unsubscribe(T.COMPLETE_EVENT, oncomplete);

        collectRunResults(event.results);
        (cb || processResults)();
    }

    function testRunner() {
        T.subscribe(T.BEGIN_EVENT, preProcessor);
        T.subscribe(T.TEST_SUITE_BEGIN_EVENT, onbegin);
        T.subscribe(T.TEST_FAIL_EVENT, onfail);
        T.subscribe(T.COMPLETE_EVENT, oncomplete);
        T.run();
    }

    tests.push(testRunner);

    // Since TestRunner is a global, it will hang onto tests from previous
    // calls to executeTestsWithinY(), and re-run them each time.
    T.clear();

    // create new YUI instance using tests and mojito
    Yinst = YUI({core: ['get', 'features', 'intl-base', 'mojito']});
    Yinst.use.apply(Yinst, tests);
}

module.exports = executeTestsWithinY;
