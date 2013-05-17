/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */


/*jslint stupid:true, node:true, nomen:true*/
'use strict';

var fs = require('fs'),
    path = require('path'),
    exists = fs.existsSync || path.existsSync,
    resolve = path.resolve,

    log = require('./log');


/**
 * returns a function that determines whether a name is excluded from a list
 * using a set of firewall style rules.
 *
 * Each rule looks like this:
 *  { pattern: /matchPattern/, include: true|false, type: file|dir|any }
 *
 *  If a file matches a rule, it is included or excluded based on the value of
 *  the include flag If rule is a regexp, it is taken to be { pattern: regexp,
 *  include: false, type: 'any' } - i.e. it is an exclusion rule.
 *  The first rule that matches, wins.
 *  The defaultIsExclude value specifies the behavior when none of the rules
 *  match (if not specified, the file is included)
 *
 * @param {Array} rules set of rules to determine what files and directories are
 *     copied.
 * @param {boolean} defaultIsExclude determines what to do when none of the
 *     rules match.
 * @return {function} A match function.
 */
function getExclusionMatcher(rules, defaultIsExclude) {

    return function isExcluded(name, ofType) {
        var index,
            include,
            pattern,
            rule,
            type,
            matchedRule,
            ret = null;

        if (!(ofType === 'file' || ofType === 'dir')) {
            throw new Error(
                'Internal error: file type was not provided, was [' +
                    ofType + ']'
            );
        }

        /* check if there are any rules */

        if (rules.length < 1) {
            throw new Error('No rules specified');
        }

        // console.log('checking ' + name + '...');
        for (index in rules) {
            // console.log('\t against ' + excludes[regex] + ': ' +
            //     name.search(excludes[regex]));
            if (rules.hasOwnProperty(index)) {

                rule = rules[index];

                if (rule instanceof RegExp) {
                    pattern = rule;
                    include = false;
                    type = 'any';
                } else {
                    pattern = rule.pattern;
                    include = !!rule.include;
                    type = rule.type || 'any';
                }

                if (!(type === 'file' || type === 'dir' || type === 'any')) {
                    throw new Error('Invalid type for match [' + type + ']');
                }

                if (!(pattern instanceof RegExp)) {
                    console.log(rule);
                    throw new Error('Pattern was not a regexp for rule');
                }

                if (name.search(pattern) !== -1 &&
                        (type === 'any' || type === ofType)) {
                    matchedRule = rule;
                    ret = !include;
                    break;
                }
            }
        }

        ret = ret === null ? !!defaultIsExclude : ret;
        //console.log('Match [' + name + '], Exclude= [' + ret + ']');
        //console.log('Used rule');
        //console.log(matchedRule);
        return ret;
    };
}


function copyFile(from, to, cb) {
    var content = fs.readFileSync(from, 'utf-8');

    fs.writeFileSync(to, content, 'utf-8');
    if (typeof cb === 'function') {
        cb();
    }
}


/**
 * recursively copies the source to destination directory based on a matcher
 * that returns whether a file is to be excluded.
 * @param {string} src source dir.
 * @param {string} dest destination dir.
 * @param {function} excludeMatcher the matcher that determines if a given file
 *     is to be excluded.
 */
function copyUsingMatcher(src, dest, excludeMatcher) {

    var filenames,
        basedir,
        i,
        name,
        file,
        newdest,
        type;

    //console.log('copying ' + src + ' to ' + dest);
    /* check if source path exists */

    if (!exists(src)) {
        throw new Error(src + ' does not exist');
    }

    /* check if source is a directory */

    if (!fs.statSync(src).isDirectory()) {
        throw new Error(src + ' must be a directory');
    }

    /* get the names of all files and directories under source in an array */

    filenames = fs.readdirSync(src);
    basedir = src;

    /* check if destination directory exists */

    if (!exists(dest)) {
        fs.mkdirSync(dest, parseInt('755', 8));
    }

    for (i = 0; i < filenames.length; i += 1) {

        name = filenames[i];
        file = basedir + '/' + name;
        type = fs.statSync(file).isDirectory() ? 'dir' : 'file';
        newdest = dest + '/' + name;

        if (!excludeMatcher(file, type)) {
            //console.log('Copy ' + file + ' as ' + newdest);
            if (type === 'dir') {
                copyUsingMatcher(file, newdest, excludeMatcher);
            } else {
                copyFile(file, newdest);
            }
        }
    }
}


function copyExclude(src, dest, excludes) {
    copyUsingMatcher(src, dest, getExclusionMatcher(excludes, false));
}


function copy(obj) {
    var temp = null,
        key = '';

    if (!obj || typeof obj !== 'object') { return obj; }
    temp = new obj.constructor();
    for (key in obj) {
        if (obj.hasOwnProperty(key)) {
            temp[key] = copy(obj[key]);
        }
    }
    return temp;
}


function removeDir(src) {
    var filenames,
        basedir,
        emptydirs,
        name,
        file,
        count;

    /* check if source path exists */
    if (!exists(src)) {
        return;
    }

    /* check if source is a directory */
    if (!fs.statSync(src).isDirectory()) {
        throw new Error(src + ' must be a directory');
    }

    /* get the names of all files and directories under source in an array */

    filenames = fs.readdirSync(src);
    basedir = src;
    emptydirs = [];

    for (name in filenames) {
        if (filenames.hasOwnProperty(name)) {
            file = basedir + '/' + filenames[name];
            if (fs.statSync(file).isDirectory()) {
                emptydirs.push(file);
                removeDir(file);
            } else {
                fs.unlinkSync(file);
            }
        }
    }
    for (count = 0; count < emptydirs.length; count += 1) {
        fs.rmdirSync(emptydirs[count]);
    }
}


function makeDir(p, mode) {

    var ps = path.normalize(p).split('/'),
        i;

    if (!mode) {
        mode = parseInt('755', 8);
    }

    for (i = 0; i <= ps.length; i += 1) {
        try {
            fs.mkdirSync(ps.slice(0, i).join('/'), mode);
        } catch (err) {
            // Dirty way to check dir
        }
    }
}

// cli/lib/utils.js
function error(code, msg) {
    var err = new Error(msg);
    err.errno = code;
    return err;
}

// cli/lib/utils.js
function exists(filepath) {
    var stat = false;
    try {
        stat = getstat(filepath);
    } catch(err) {
    }
    return stat;
}

// cli/lib/utils.js
function findInPaths(paths, target) {
    var pathname;

    function checkpath(basedir) {
        var stat;
        pathname = resolve(basedir, target);
        stat = exists(pathname);
        log.debug('archetype%s in path %s', stat ? '' : ' not', basedir);
        return stat;
    }

    return paths.some(checkpath) && pathname;
}

exports.copyExclude = copyExclude;

exports.copyFile = copyFile;

exports.copy = copy;

exports.removeDir = removeDir;

exports.makeDir = makeDir;

exports.getExclusionMatcher = getExclusionMatcher;

exports.copyUsingMatcher = copyUsingMatcher;

exports.error = error;

exports.exists = exists;

exports.findInPaths = findInPaths;
