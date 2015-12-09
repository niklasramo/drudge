/*

Design goals
============

* Tagline: Highly configurable static site/app/blog/whatever generator.
* Gulp based file streaming that allows hooking into the stream.
* Easy to use and configure with good presets.
* Fast builds. Use advanced file caching techniques to maximize the build speed.
* Everything is optional. At minimun configuration Drudge should only clone the
  source directory and nothing else.

v0.1.0
======
  * [x] Build report -> files and their sizes in the command line.
  * [x] Caching to improve build speed.
  * [x] Replace Esprima and JSCS with ESLint.
  * [x] Scaffolding. Allow easy way to init custom project bases.
  * [ ] File activity reporting. Log stuff that happens in tasks. And make it
        optional.
  * [ ] Create a nice API for the build flow that allows plugging custom
        functionality between the build steps.
  * [ ] Make sure Drudge plays nicely with Angular/React projects.
  * [ ] Easier (more restricted) configuration. Consider leaning towards magic
        and conventions instead of configuration.
  * [ ] The default src directory should demonstrate all features.
  * [ ] Docs and readme.
  * [ ] Github pages website, naturally built with Drudge ;)
  * [ ] Unit tests.

v0.2.0
======
  * [] Nunjucks powerups
    * [] moment.js -> https://www.npmjs.com/package/nunjucks-date-filter
    * [] i18n -> https://www.npmjs.com/package/nunjucks-i18n
  * [] CSS/JS sourcemaps.
  * [] Generate multisize favicon.ico (16+24+32+48).
  * [] Offline HTML validator.
  * [] Babel integration (Maybe this is a bad idea, debugging transformed code
       sounds like a massive PITA).
  * [] Autoprefixer. Needs a lot of consideration since using it may turn out to
       be a debug nightmare. There are still some open issues the developer
       needs to be aware about and CSS hacks might get broken during the
       post-processing process.
  * [] Allow user to define the CSS pre/post processor engine:
       Less/Sass/PostCSS
  * [] Basic speed report -> Page by page size report (divided into total size
       per asset type, e.g. scripts, styles, images).
  * [] Basic SEO report -> Page by page SEO report.

*/

//
// Modules
//

var _ = require('lodash');
var fs = require('fs-extra');
var path = require('path');
var del = require('del');
var htmlMinifier = require('html-minifier').minify;
var nunjucks = require('nunjucks');
var nunjucksMarkdown = require('nunjucks-markdown');
var marked = require('marked');
var jimp = require('jimp');
var appRoot = require('app-root-path');
var browserSync = require('browser-sync');
var yamljs = require('yamljs');
var through2 = require('through2');
var js2xmlparser = require("js2xmlparser");
var vinylPaths = require('vinyl-paths');
var isOnline = require('is-online');
var lazypipe = require('lazypipe');
var filesize = require('filesize');
var gulp = require('gulp');
var util = require('gulp-util');
var sass = require('gulp-sass');
var sassLint = require('gulp-sass-lint');
var uglify = require('gulp-uglify');
var useref = require('gulp-useref');
var gulpif = require('gulp-if');
var sequence = require('gulp-sequence');
var foreach = require('gulp-foreach');
var revAll = require('gulp-rev-all');
var change = require('gulp-change');
var w3cjs = require('gulp-w3cjs');
var imagemin = require('gulp-imagemin');
var sitemap = require('gulp-sitemap');
var uncss = require('gulp-uncss');
var cache = require('gulp-cached');
var rename = require('gulp-rename');
var cssnano = require('gulp-cssnano');
var eslint = require('gulp-eslint');

//
// Local variables
//

// The build tasks (and their dependencies) in the exection order. The first
// item in the build task item array represents the gulp task's name and the
// following items represent which properties (if any) must exist in the
// Mylly configuration object as truthy value in order for the task to be
// included in the Mylly instance's build tasks.
var taskQueue = [
  ['pre-build:lint-js', 'lintJs'],
  ['pre-build:lint-sass', 'lintSass'],
  ['build:setup'],
  ['build:templates', 'templates'],
  ['build:sass', 'sass'],
  ['build:collect-assets', 'collectAssets'],
  ['build:minify-js', 'minifyJs'],
  ['build:minify-html', 'minifyHtml'],
  ['build:clean-css', 'cleanCss'],
  ['build:minify-css', 'minifyCss'],
  ['build:sitemap', 'sitemap'],
  ['build:browserconfig', 'browserconfig'],
  ['build:generate-images', 'generateImages'],
  ['build:optimize-images', 'optimizeImages'],
  ['build:revision', 'revision'],
  ['build:clean'],
  ['post-build:validate-html', 'validateHtml'],
  ['post-build:report', 'report']
];

var allowedConfigTypes = {
  srcPath: ['string'],
  buildPath: ['string'],
  distPath: ['string'],
  lintJs: ['object|null', {
    files: ['array|string'],
    options: ['object|string']
  }],
  lintSass: ['object|null', {
    files: ['array|string'],
    configPath: ['string']
  }],
  templates: ['object|null', {
    files: ['array|string'],
    id: ['string'],
    contextId: ['string'],
    data: ['object|null'],
    markdown: ['object|null'],
    options: ['object']
  }],
  sass: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  collectAssets: ['object|null', {
    files: ['array|string']
  }],
  minifyJs: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  minifyHtml: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  cleanCss: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  minifyCss: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  sitemap: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  browserconfig: ['object|null', {
    tile70x70: ['string'],
    tile150x150: ['string'],
    tile310x150: ['string'],
    tile310x310: ['string'],
    tileColor: ['string']
  }],
  generateImages: ['array|null'],
  optimizeImages: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  revision: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  validateHtml: ['object|null', {
    files: ['array|string'],
    options: ['object']
  }],
  report: ['boolean'],
  cleanBefore: ['array|string'],
  cleanAfter: ['array|string'],
  browsersync: ['object']
};

// Get project root path.
var projectRoot = __dirname;

// Mylly configuration file path (relative).
var configPath = '/mylly.config.js';

// Get mylly base configuration.
var baseCfg = getFileData(projectRoot + configPath);

// Build queue.
var $Q = Promise.resolve();

// Currently active Mylly instance.
var $D;

// Mylly instance id
var MyllyId = 0;

//
// Mylly constructor
//

function Mylly(opts) {

  var inst = this;

  // Generate id for the instance.
  inst.id = ++MyllyId;

  // Sanitize options.
  opts = _.isPlainObject(opts) ? opts : _.isString(opts) ? getFileData(opts) : {};

  // Store configuration to instance.
  inst.config = sanitizeOptions(_.assign({}, baseCfg, opts));

  // Create Browsersync instance.
  inst.browsersync = browserSync.create();

  // Create Nunjucks instance.
  inst.nunjucks = nunjucks.configure(inst.config.srcPath, inst.config.templates ? inst.config.templates.options : {});

  // Create revAll instance.
  inst.revAll = new revAll(inst.config.revision ? inst.config.revision.options : {});

  // Build task queue.
  inst.tasks = _.chain(taskQueue.slice(0))
  .filter(function (taskItem) {
    return _.reduce(taskItem.slice(1), function (result, cfgProp) {
      return result ? !!inst.config[cfgProp] : result;
    }, true);
  })
  .map(function (val) {
    return val[0];
  })
  .value();

}

Mylly.prototype._setup = function () {

  var inst = this;

  return new Promise(function (res) {

    // Clear file cache if build instance is changed.
    if ($D !== inst) {
      cache.caches = {};
    }

    // Setup build instance.
    $D = inst;

    // Setup marked.
    if (inst.config.templates && inst.config.templates.markdown) {
      marked.setOptions(inst.config.templates.markdown);
      nunjucksMarkdown.register(inst.nunjucks, marked);
    }

    res(inst);

  });

};

Mylly.prototype.init = function () {

  var inst = this;

  return new Promise(function (resolve) {

    if (!pathExists(inst.config.srcPath)) {
      fs.copySync(projectRoot + '/src', inst.config.buildPath);
    }

    if (!pathExists(appRoot + configPath)) {
      fs.copySync(projectRoot + configPath, appRoot + configPath);
    }

    resolve(inst);

  });

};

Mylly.prototype.build = function () {

  var inst = this;

  return $Q = $Q.then(function () {
    return inst._setup();
  })
  .then(function () {
    return new Promise(function (resolve, reject) {
      sequence('build')(function (err) {
        if (err) reject(err);
        resolve(inst);
      });
    });
  })
  .catch(function (err) {

    // Let's atomize the temporary distribution directory
    // if a build fails.
    if (pathExists(inst.config.buildPath)) {
      fs.removeSync(inst.config.buildPath);
    }

    return inst;

  });

};

Mylly.prototype.server = function () {

  var inst = this;

  return inst.build().then(function () {
    return new Promise(function (resolve) {
      inst.browsersync.init(inst.config.browsersync);
      gulp.watch(inst.config.srcPath + '/**/*', function () {
        inst.build().then(function () {
          inst.browsersync.reload();
        });
      });
      resolve(inst);
    });
  });

};

//
// Custom helpers
//

function sanitizeOptions(opts) {

  opts = _.assign({}, _.isPlainObject(opts) ? opts : {});

  validateOptionBranch(allowedConfigTypes, opts);

  return opts;

}

function validateOptionBranch(treeBranch, optsBranch) {

  _.forEach(treeBranch, function (val, key) {

    var
    optionValue = optsBranch[key],
    allowedValues = val[0],
    nestedRules = val[1];

    if (!typeCheck(optionValue, allowedValues)) {
      console.log(key);
      throw new TypeError('Configuration object has bad data.');
    }

    if (optionValue && typeOf(nestedRules, 'object')) {
      validateOptionBranch(nestedRules, optionValue);
    }

  });

}

function typeOf(value, isType) {

  var
  type = typeof value;

  type = type !== 'object' ? type : ({}).toString.call(value).split(' ')[1].replace(']', '').toLowerCase();

  return isType ? type === isType : type;

}

function typeCheck(value, types) {

  var
  ok = false,
  typesArray = types.split('|');

  _.forEach(typesArray, function (type) {

    ok = !ok ? typeOf(value, type) : ok;

  });

  return ok;

}

function pathExists(filePath) {

  try {
    var stat = fs.statSync(filePath);
    return stat.isFile() || stat.isDirectory();
  }
  catch (err) {
    return false;
  }

}

function genSrc(root, src) {

  if (_.isString(src)) {
    if (src.charAt(0) === '!') {
      return ['!' + root + src.replace('!', '')];
    }
    else {
      return [root + src];
    }
  }
  else if (_.isArray(src)) {
    return src.map(function (val) {
      if (val.charAt(0) === '!') {
        return '!' + root + val.replace('!', '');
      }
      else {
        return root + val;
      }
    });
  }
  else {
    return [];
  }

}

function getFileData(filePath) {

  return pathExists(filePath) ? require(filePath) : {};

}

function getTemplateData(file) {

  // Get template core data.
  var tplCoreData = $D.config.templates.data;

  // Get JSON context file.
  var tplJsonData = path.parse(file.path);
  tplJsonData.name = tplJsonData.name + $D.config.templates.contextId;
  tplJsonData.ext = '.json';
  tplJsonData.base = tplJsonData.name + tplJsonData.ext;
  tplJsonData = getFileData(path.format(tplJsonData));

  // Get JS context file.
  var tplJsData = path.parse(file.path);
  tplJsData.name = tplJsData.name + $D.config.templates.contextId;
  tplJsData.ext = '.js';
  tplJsData.base = tplJsData.name + tplJsData.ext;
  tplJsData = getFileData(path.format(tplJsData));

  // Provide JSON data as context for JS data function (if it exists).
  if (_.isFunction(tplJsData)) {
    tplJsData = tplJsData(tplCoreData, tplJsonData);
  }

  return _.assign({}, tplCoreData, tplJsonData, tplJsData);

}

function nunjucksRender(content) {

  var file = this.file;
  var data = getTemplateData(file);
  return $D.nunjucks.render(path.relative($D.config.srcPath, file.path), data);

}

function minifyHtml(content) {

  return htmlMinifier(content, $D.config.minifyHtml.options);

}

function w3cjsReporter() {

  return through2.obj(function (file, enc, cb) {
    cb(null, file);
    if (file.w3cjs && !file.w3cjs.success) {
      util.log('HTML validation error(s) found');
    }
  });

}

function logSkipTask(taskName, reason) {

  util.log(util.colors.yellow("Skipping"), "'" + util.colors.cyan(taskName) + "'", util.colors.red(reason));

}

function getNicePath(from, to) {

  return path.normalize(from + '/' + path.relative(from, to))

}

function logFiles(rootPath, action, fileTypes) {

  var msg, color;

  if (action === 'edit') {
    msg = '>';
    color = 'yellow';
  }

  if (action === 'remove') {
    msg = 'x';
    color = 'red';
  }

  if (action === 'create') {
    msg = '+';
    color = 'green';
  }

  return through2.obj(function (file, enc, cb) {
    var fileType = fileTypes ? path.extname(file.path) : false;
    var isCorrectFileType = fileTypes ? fileType && fileTypes.indexOf(fileType) > -1 : true;
    if (file.stat && file.stat.isFile() && isCorrectFileType) {
      util.log(msg, util.colors[color](getNicePath(rootPath || './', file.path)));
    }
    cb(null, file);
  });

}

//
// Tasks
//

// Lint JavaScript files.
gulp.task('pre-build:lint-js', function (cb) {

  return gulp
  .src(genSrc($D.config.srcPath, $D.config.lintJs.files), {
    base: $D.config.srcPath
  })
  .pipe(cache($D.id + '-lint-js'))
  .pipe(eslint($D.config.lintJs.options))
  .pipe(eslint.format())
  .pipe(eslint.failAfterError())
  .pipe(logFiles($D.config.srcPath, 'edit'));

});

// Lint SASS stylesheets.
gulp.task('pre-build:lint-sass', function (cb) {

  return gulp
  .src(genSrc($D.config.srcPath, $D.config.lintSass.files), {
    base: $D.config.srcPath
  })
  .pipe(cache($D.id + '-lint-sass'))
  .pipe(sassLint(yamljs.load($D.config.lintSass.configPath)))
  .pipe(sassLint.format())
  .pipe(sassLint.failOnError())
  .pipe(logFiles($D.config.srcPath, 'edit'));

});

// 1. Delete distribution and temporary distribution directories.
// 2. Clone the source directory as the distribution directory.
// 3. Remove "cleanBefore" files/directories.
gulp.task('build:setup', function () {

  fs.removeSync($D.config.buildPath);
  fs.copySync($D.config.srcPath, $D.config.buildPath);

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.cleanBefore), {
    base: $D.config.buildPath,
    read: false
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(vinylPaths(del));

});

// Compile Nunjucks templates. (use srcPath and cache the output templates also)
gulp.task('build:templates', function (cb) {

  return gulp
  .src(genSrc($D.config.srcPath, $D.config.templates.files), {
    base: $D.config.srcPath
  })
  .pipe(logFiles($D.config.srcPath, 'edit'))
  .pipe(change(nunjucksRender))
  .pipe(rename(function (path) {
    path.basename = path.basename.replace($D.config.templates.id, '');
  }))
  .pipe(gulp.dest($D.config.buildPath))
  .pipe(logFiles($D.config.buildPath, 'create'));

});

// Compile source directory's Sass stylesheets to distribution directory.
gulp.task('build:sass', function (cb) {

  return gulp
  .src(genSrc($D.config.srcPath, $D.config.sass.files), {
    base: $D.config.srcPath
  })
  .pipe(logFiles($D.config.srcPath, 'edit'))
  .pipe(foreach(function (stream, file) {
    var sassOpts = $D.config.sass.options;
    sassOpts.outFile = util.replaceExtension(path.basename(file.path), 'css');
    return stream.pipe(sass(sassOpts));
  }))
  .pipe(gulp.dest($D.config.buildPath))
  .pipe(logFiles($D.config.buildPath, 'create'));

});

// Generate concatenated scripts and styles from useref markers in HTML files within the distribution folder.
gulp.task('build:collect-assets', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.collectAssets.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(useref())
  .pipe(logFiles($D.config.buildPath, 'create', ['.js', '.css']))
  .pipe(gulp.dest($D.config.buildPath));

});

// Minify all specified scripts in distribution folder.
gulp.task('build:minify-js', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.minifyJs.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(uglify($D.config.minifyJs.options))
  .pipe(gulp.dest($D.config.buildPath));

});

// Minify all specified html files in distribution folder.
gulp.task('build:minify-html', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.minifyHtml.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(change(minifyHtml))
  .pipe(gulp.dest($D.config.buildPath));

});

// Remove unused styles from specified stylesheets.
gulp.task('build:clean-css', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.cleanCss.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(uncss($D.config.cleanCss.options))
  .pipe(gulp.dest($D.config.buildPath));

});

// Minify specified css files with cssnano.
gulp.task('build:minify-css', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.minifyCss.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(cssnano())
  .pipe(gulp.dest($D.config.buildPath));

});

// Generate sitemap.xml based on the HTML files in distribution directory.
gulp.task('build:sitemap', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.sitemap.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(sitemap($D.config.sitemap.options))
  .pipe(gulp.dest($D.config.buildPath))
  .on('end', function () {
    util.log('+', util.colors.green(getNicePath($D.config.buildPath, $D.config.buildPath + '/sitemap.xml')));
  });

});

// Generate browserconfig.xml.
gulp.task('build:browserconfig', function (cb) {

  var data = js2xmlparser('browserconfig', {
    'msapplication': {
      'tile': {
        'square70x70logo': {'@': {'src': $D.config.browserconfig.tile70x70}},
        'square150x150logo': {'@': {'src': $D.config.browserconfig.tile150x150}},
        'square310x150logo': {'@': {'src': $D.config.browserconfig.tile310x150}},
        'square310x310logo': {'@': {'src': $D.config.browserconfig.tile310x310}},
        'TileColor': $D.config.browserconfig.tileColor
      }
    }
  });

  fs.writeFile($D.config.buildPath + '/browserconfig.xml', data, function (err) {
    if (err) cb(err);
    util.log('+', util.colors.green(getNicePath($D.config.buildPath, $D.config.buildPath + '/browserconfig.xml')));
    cb();
  });

});

// Generate new images with Jimp.
gulp.task('build:generate-images', function () {

  var ret = Promise.resolve();
  var sets = ($D.config.generateImages || []);

  sets.forEach(function (set) {

    ret = ret.then(function (resolve, reject) {

      var sourcePath = path.normalize($D.config.buildPath + set.source);
      util.log('>', util.colors.yellow(sourcePath));

      set.sizes.forEach(function (size) {

        var targetPath = path.normalize($D.config.buildPath + set.target.replace('{{ width }}', size[0]).replace('{{ height }}', size[1]));

        if (!pathExists(targetPath)) {

          jimp.read(sourcePath, function (err, img) {

            if (err) { reject(err); }

            img
            .resize(size[0], size[1])
            .write(targetPath, function (err, val) {

              if (err) { reject(err); }

              util.log('+', util.colors.green(targetPath));

              resolve(val);

            });

          });

        }

      });


    });

  });

  return ret;

});

// Optimize images with imagemin.
gulp.task('build:optimize-images', function (cb) {

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.optimizeImages.files), {
    base: $D.config.buildPath
  })
  .pipe(logFiles($D.config.buildPath, 'edit'))
  .pipe(imagemin($D.config.optimizeImages.options))
  .pipe(gulp.dest($D.config.buildPath));

});

// Revision files and references.
gulp.task('build:revision', function () {

  var origFilePaths = [];
  var newFilePaths = [];

  return gulp
  .src(genSrc($D.config.buildPath, $D.config.revision.files), {
    base: $D.config.buildPath
  })
  .pipe(change(function (content) {
    origFilePaths.push(this.file.path);
    return content;
  }))
  .pipe($D.revAll.revision())
  .pipe(change(function (content) {
    newFilePaths.push(this.file.path);
    return content;
  }))
  .pipe(gulp.dest($D.config.buildPath))
  .on('end', function () {

    var junkFiles = [];
    _.forEach(origFilePaths, function (origFilePath, i) {
      if (origFilePath !== newFilePaths[i]) {
        var formattedPath = '/' + path.relative($D.config.buildPath, origFilePath).split(path.sep).join('/');
        junkFiles.push(formattedPath);
        util.log('x', util.colors.red(getNicePath($D.config.buildPath || './', origFilePath)));
      }
    });

    del.sync(genSrc($D.config.buildPath, junkFiles), {force: true});

  });

});

// 1. Atomize distribution directory if it exists.
// 2. Rename temporary directory (if it exists) to distribution directory.
// 3. Atomize all unwanted files/directories.
gulp.task('build:clean', function (cb) {

  if (pathExists($D.config.distPath)) {
    fs.removeSync($D.config.distPath);
  }

  if (pathExists($D.config.buildPath)) {
    fs.renameSync($D.config.buildPath, $D.config.distPath);
  }

  return gulp
  .src(genSrc($D.config.distPath, $D.config.cleanAfter), {
    base: $D.config.distPath,
    read: false
  })
  .pipe(logFiles($D.config.distPath, 'remove'))
  .pipe(vinylPaths(del));

});

// Validate HTML markup against W3C standards.
gulp.task('post-build:validate-html', function (cb) {

  isOnline(function (err, online) {
    if (err) {
      cb(err);
    }
    else if (!online) {
      logSkipTask('post-build:validate-html', 'No Internet connection');
      cb();
    }
    else {
      sequence('post-build:validate-html-run')(cb);
    }
  });

});

// Validate HTML markup against W3C standards.
gulp.task('post-build:validate-html-run', function () {

  return gulp
  .src(genSrc($D.config.distPath, $D.config.validateHtml.files), {
    base: $D.config.distPath
  })
  .pipe(logFiles($D.config.distPath, 'edit'))
  .pipe(w3cjs())
  .pipe(w3cjsReporter());

});

gulp.task('post-build:report', function () {

  var report = {
    totalSize: 0,
    totalAmount: 0,
    files: {}
  };

  return gulp
  .src(genSrc($D.config.distPath, '/**/*'), {
    base: $D.config.distPath
  })
  .pipe(through2.obj(function (file, enc, cb) {
    if (file.stat.isFile()) {
      var filePath = path.relative($D.config.distPath, file.path);
      var fileSize = file.stat.size;
      var fileType = path.extname(file.path);
      report.totalSize += fileSize;
      report.totalAmount += 1;
      report.files[fileType] = report.files[fileType] || [];
      report.files[fileType].push({
        path: filePath,
        size: fileSize
      });
    }
    cb(null, file);
  }))
  .on('end', function () {

    util.log('');
    util.log('Build report');
    util.log(util.colors.gray('------------'));
    util.log('');
    util.log('A total of ' + util.colors.cyan(report.totalAmount) + ' files weighing ' + util.colors.magenta(filesize(report.totalSize, {round: 0})) + ' were generated.');
    util.log('');

    _.forEach(report.files, function (fileTypeData, fileType) {

      var fileTypeSize = filesize(_.reduce(fileTypeData, function (total, val) {
        return total + val.size;
      }, 0), {round: 0});

      util.log(util.colors.green(fileType), util.colors.cyan(fileTypeData.length), util.colors.magenta(fileTypeSize));

      _.forEach(fileTypeData, function (fileData) {
        util.log('  ' + fileData.path, util.colors.magenta(filesize(fileData.size, {round: 0})));
      });

    });

    util.log('');

  });

});

// Build the distribution directory from the source files.
gulp.task('build', function (cb) {

  sequence.apply(null, $D.tasks)(cb);

});

gulp.task('default', function () {

  return (new Mylly()).build();

});

gulp.task('server', function () {

  return (new Mylly()).server();

});

//
// Exports
//

module.exports = function (opts) {

  return new Mylly(opts);

};