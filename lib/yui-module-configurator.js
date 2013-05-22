/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
'use strict';

var fs = require('fs'),
    vm = require('vm'),
    pa = require('path'),
    utils = require('./utils'),
    walkDir,
    updateModulesWithFile,
    isExcluded,

    // creating a vm context to execute all files
    // we want to reuse it because it is 200x faster
    // than creating a new one per file.
    contextForRunInContext = vm.createContext({
        console: {
            log: function() {}
        },
        window: {},
        document: {},
        YUI: null
    });

walkDir = function(dir, modules, excludes) {
    var files = fs.readdirSync(dir),
        filepath,
        meta,
        i = 0,
        fstat;

    for (i = 0; i < files.length; i += 1) {
        filepath = pa.join(dir, files[i]);
        if (!isExcluded(filepath, excludes)) {
            fstat = fs.statSync(filepath);
            if (fstat.isDirectory()) {
                walkDir(filepath, modules, excludes);
            } else if (fstat.isFile()) {
                updateModulesWithFile(modules, meta, filepath, excludes);
            }
        }
    }
};


updateModulesWithFile = function(modules, meta, fullpath) {
    var file;

    if (pa.extname(fullpath) === '.js') {
        file = fs.readFileSync(fullpath, 'utf8');

        // setting up the fake YUI before executing the file
        contextForRunInContext.YUI = {
            add: function(name, fn, version, meta) {
                if (!meta) {
                    meta = {};
                }
                modules[name] = {
                    fullpath: fullpath,
                    requires: meta.requires || []
                };
            }
        };
        try {
            vm.runInContext(file, contextForRunInContext, fullpath);
        } catch (e) {
            utils.error(e.message + ' in file: ' + fullpath, null, true);
        }
    }
};


isExcluded = function(path, ex) {
    var i,
        exclude;

    for (i = 0; i < ex.length; i += 1) {
        exclude = ex[i];
        if (path.match(exclude)) {
            return true;
        }
    }

    return false;
};


/**
 * Configures modules in a directory, ignoring any excluded by the exclusions
 * provided.
 * @param {string} dir The directory name to walk/configure.
 * @param {Array} excludes A list of exclusions.
 * @return {Object} A map of modules.
 */
module.exports = function(dir, excludes) {

    var modules = {},
        i;

    if (!excludes) {
        excludes = [];
    }

    if (dir === undefined) {
        return modules;
    }

    if (!Array.isArray(dir)) {
        dir = [dir];
    }

    for (i = 0; i < dir.length; i += 1) {
        walkDir(dir[i], modules, excludes);
    }

    return modules;
};
