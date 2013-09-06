/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
'use strict';

var ymc = require('./yui-module-configurator'),

    TEST_WITH = ['mojito', 'mojito-test'], // always include these base modules
    TEST_RE = /-tests?$/;


/**
 * (modifes YUI)
 * @return {object}
 * e.g.
 *  {
 *    ReadController: {
 *      requires: ['mojito', 'mojito-config-addon', 'mojito-models-addon'…
 *      fullpath: '/Users/isao/Repos/mojito/apps/newsboxes/mojits/Read/co…
 *    },…
 *  }
 */
function appConfigs(Store, YUI, appdir) {
    var store = Store.createStore({
            root: appdir,
            context: {},
            appConfig: { env: 'test' }
        }),
        config = store.yui.getModulesConfig('server');

    config.useSync = true;
    YUI.applyConfig(config);

    return store.yui.getModulesConfig('server').modules;
}

/**
 * (modifes YUI)
 * @return {object}
 */
function mojitConfigs(path, testPath, libpath, YUI) {
    var testConfigs = ymc(path),
        sourceConfigs = ymc(testPath, [TEST_RE]);

    // clobbering the original sources with instrumented sources
    Object.keys(sourceConfigs).forEach(function(k) {
        testConfigs[k] = sourceConfigs[k];
    });

    testConfigs['mojito-test'] = {
        fullpath: libpath.join(libpath, 'lib/app/autoload/mojito-test.common.js'),
        requires: ['mojito']
    };

    testConfigs.mojito = {
        fullpath: libpath.join(libpath, 'lib/app/autoload/mojito.common.js')
    };

    YUI.applyConfig({
        modules: testConfigs
    });

    return testConfigs;
}

/**
 * @return {array}
 * e.g. ['ReadController-tests', 'ReadModel-tests',… 'mojito', 'mojito-test']
 */
function filterNames(modlist, list) {
    var names = TEST_WITH.concat();

    function regex(name) {
        if (name.match(TEST_RE)) {
            names.push(name);
        }
    }

    function listcheck(name) {
        if ((list.indexOf(name) > -1) || (list.indexOf(name + '-tests') > -1)
            || (list.indexOf(name + '-test') > -1)) {
            names.push(name);
        }
    }

    Object.keys(modlist).forEach(list.length ? listcheck : regex);

    return names.sort();
}

module.exports = {
    appConfigs: appConfigs,
    mojitConfigs: mojitConfigs,
    filterNames: filterNames
}
