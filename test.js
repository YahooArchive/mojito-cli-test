/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
'use strict';

// TODO: return error objects w/ exit codes, not strings

var join = require('path').join,
    exists = require('fs').existsSync,
    tmpdir = require('os').tmpdir,
    util = require('./lib/utils'),
    log = require('./lib/log'),

    YUI = require('yui').YUI,
    YUITest = require('yuitest').YUITest,
    TestRunner = YUITest.TestRunner,

    ymod = require('./lib/module'),
    run = require('./lib/run'),
    usage;


function testApp(conf, env, cb) {
    var Store = require(join(env.mojito.path, 'lib/store')),
        testConfigs = ymod.appConfigs(Store, YUI, conf.source),
        testModuleNames = ymod.filterNames(testConfigs, conf.list);

    log.info(testModuleNames)
    run(testModuleNames, YUI, TestRunner);
}

function testMojit(conf, store, cb) {

}

function exec(conf, env, cb) {

    if ('app' === conf.type) {
        testApp(conf, env, cb);
    } else {
        testMojit(conf, env, cb);
    }

}

function main(env, cb) {
    var type = (env.args.shift() || 'app').toLowerCase(),
        dest = env.opts.directory || 'artifacts/test',
        list = env.opts.testname,
        temp = env.opts.tmpdir || tmpdir(), // only used for coverage
        source = env.args.shift() || '.';

    // list is an optional array of test module names to limit testing to
    // BC: 3rd arg was comma separated list of test module names
    if (!list) {
        list = env.args.length ? env.args.shift().split(',') : [];
    }

    // BC: verbose == debug
    if (env.opts.verbose && !env.opts.loglevel) {
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
    if ('mojit' === type) {
        source = util.findInPaths(['mojits', '.'], source);
        if (!source) {
            cb('Could not find mojit.');
            return;
        }
    }

    if (!source || !exists(source)) {
        cb('Invalid source directory.');
        return;
    }

    if (env.opts.coverage) {

    }

    exec({
        type: type,
        source: source,
        dest: dest,
        temp: temp,
        list: list
    }, env, cb || log.info);
}

/**
 * yes, need this to prevent "ReferenceError: YUITest is not defined" :(
 * @fixme?
 */
global.YUITest = YUITest;

/**
 * Add ability to skip tests without breaking.
 * @fixme? is this still needed?
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
    {shortName: null, hasValue: true, longName: 'tmpdir'},
    {shortName: 't', hasValue: [String, Array], longName: 'testname'},
    {shortName: 'v', hasValue: false, longName: 'verbose'}
];
