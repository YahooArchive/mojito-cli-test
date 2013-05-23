
var Store = require('/Users/isao/Repos/mojito/myfork/lib/store'),
    YUI = require('yui').YUI,
    YUITest = require('yuitest').YUITest,
    TestRunner = YUITest.TestRunner,

    mkdirp = require('mkdirp').sync,
    rimraf = require('rimraf').sync,
    log = require('./lib/log'),

    TEST_WITH = ['mojito', 'mojito-test'], // always include these base modules
    TEST_RE = /-tests$/;

var testQueue = [],
    collectedFailures = [],
    collectedResults = [],
    collectedJUnitXML = [],
    collectedCoverage = {};


function getModulesConfig(Store, appdir) {
    var store = Store.createStore({
            root: appdir,
            context: {},
            appConfig: { env: 'test' }
        }),
        config = store.yui.getModulesConfig('server');

    config.useSync = true;
    YUI.applyConfig(config);

    return store.yui.getModulesConfig('server').modules;
    // e.g.
    // {
    //     ReadController: {
    //         requires: ['mojito', 'mojito-config-addon', 'mojito-models-addon', 'mojito-params-addon', 'ReadModelRss'],
    //         fullpath: '/Users/isao/Repos/mojito/apps/newsboxes/mojits/Read/controller.common.js'
    //     },
    //     ReadModelRss: {
    //         requires: ['mojito', 'yql', 'jsonp-url'],
    //         fullpath: '/Users/isao/Repos/mojito/apps/newsboxes/mojits/Read/models/rss.common.js'
    //     },
    //     'ReadController-tests': {
    //         requires: ['mojito-test', 'ReadController'],
    //         fullpath: '/Users/isao/Repos/mojito/apps/newsboxes/mojits/Read/tests/controller.common-tests.js'
    //     },
    //     'ReadModelRss-tests': {
    //         requires: ['mojito-test', 'ReadModelRss'],
    //         fullpath: '/Users/isao/Repos/mojito/apps/newsboxes/mojits/Read/tests/rss.common-tests.js'
    //     },
    // ...etc
}

function getTestModuleNames(modlist, whitelist) { //todo whitelist
    var names = TEST_WITH.concat();
    Object.keys(modlist).forEach(function(name) {
        if (name.match(TEST_RE)) {
            names.push(name);
        }
    });

    return names.sort();
    // e.g.
    // [ 'ReadController-tests',
    //   'ReadModelRss-tests',
    //   'ShelfController-tests',
    //   'mojito',
    //   'mojito-test' ]
}

function preProcessor() {
//     rimraf(coverageDir);
//     mkdirp(coverageDir);
//     rimraf(resultsDir);
//     mkdirp(resultsDir);
}

function collectFailure(suiteName, event) {
    collectedFailures.push({
        suiteName: suiteName,
        caseName: event.testCase.name,
        testName: event.testName,
        message: event.error.getMessage(),
        stack: event.error.stack
    });
}

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
                //processResults();
                console.log('done');
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



var appdir = '/Users/isao/Repos/mojito/apps/newsboxes/';
var testConfigs = getModulesConfig(Store, appdir);
var testModuleNames = getTestModuleNames(testConfigs);

global.YUITest = YUITest;

executeTestsWithinY(testModuleNames);



