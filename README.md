mojito-cli-test
===============

This package provides the `test` command for the [`mojito-cli`](https://github.com/yahoo/mojito-cli) tool.
Install `mojito-cli` and `mojito-cli-test` with the following: `npm install -g mojito-cli`

Usage
-----

The `test` command uses [yuitest](https://github.com/yui/yuitest) to run unit tests in files ending in `-tests.js`, and whose YUI module name ends in `-test` or `-tests`.

The command should be invoked at the top directory level of your mojito application, which should also have
`mojito` [installed locally](https://github.com/yahoo/mojito-cli/wiki/NpmInstallation).

    mojito test [options] <app|mojit> [path]

### Examples

To run all tests for a Mojito application:

    $ cd path/to/mojito/app
    $ mojito test app

To run just a mojit's tests:

    $ mojito test mojit path/to/mojit

or:

    $ mojito test mojit MojitName

By default, the test results are written to both `stdout` and saved in a JUnitXML-formatted file at
`artifacts/test/result.xml`. To specify a different destination, use the `--directory` option (see below).

A particular test module (i.e., the YUI module name) can be specified with the `--testname` option. This option can be used multiple times. For example:

    $ mojito test app --testname mod-tests --testname mod-tests

### Options

Instrument the code and generate a code coverage report, using [yuitest-coverage](https://npmjs.org/package/yuitest-coverage):

    --coverage
    -c

To specify a destination directory for the test results (default is `artifacts/test`):

    --directory <path>
    -d <path>

To specify a temporary directory that will be used to copy instrumented code for code coverage, use the
option below. By default, the system's default directory for temp files is used, as determined
by [`os.tmpdir()`](http://nodejs.org/api/os.html#os_os_tmpdir).

    --tempdir <path>
    -t <path>

To enable diagnostic output to the console, use any of the following flags:

    --debug
    --verbose
    -v

Discussion/Forums
-----------------

http://developer.yahoo.com/forum/Yahoo-Mojito

Licensing and Contributions
---------------------------

BSD licensed, see LICENSE.txt. To contribute to the Mojito project, please see [Contributing](https://github.com/yahoo/mojito/wiki/Contributing-Code-to-Mojito).

The Mojito project is a [meritocratic, consensus-based community project](https://github.com/yahoo/mojito/wiki/Governance-Model),
which allows anyone to contribute and gain additional responsibilities.
