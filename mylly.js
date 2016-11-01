// TODO
// - [x] Optionally validate SASS (Sass Lint)
// - [x] Optionally validate JS (ESLint)
// - [x] Optionally generate sitemap.xml (gulp-sitemap)
// - [x] Browsersync integration.
// - [x] Separate mylly in it's own file.
// - [x] Task: psi
// - [x] Task: psi-all
// - [x] Task: size
// - [x] Task: report-a11y (https://www.npmjs.com/package/a11y)
// - [ ] Build-step: Generate favicons from a master icon.
// - [ ] Build-step: Validate html.
// - [ ] Build-step: Uncss.
// - [ ] Task: deploy (zeit now / google firebase integration)

//
// Node core depencenies
//

var path = require('path');
var fs = require('fs');

//
// Dependencies
//

var browserSync = require('browser-sync').create();
var del = require('del');
var gulp = require('gulp');
var gulpA11y = require('gulp-a11y');
var gulpChange = require('gulp-change');
var gulpCleanCss = require('gulp-clean-css');
var gulpEslint = require('gulp-eslint');
var gulpFilter = require('gulp-filter');
var gulpImagemin = require('gulp-imagemin');
var gulpRename = require('gulp-rename');
var gulpReplace = require('gulp-replace');
var gulpSass = require('gulp-sass');
var gulpSassLint = require('gulp-sass-lint');
var gulpSitemap = require('gulp-sitemap');
var gulpSize = require('gulp-size');
var gulpUglify = require('gulp-uglify');
var gulpUncss = require('gulp-uncss');
var gulpUseref = require('gulp-useref');
var gulpWatch = require('gulp-watch');
var htmlclean = require('htmlclean');
var imageminGifsicle = require('imagemin-gifsicle');
var imageminJpegtran = require('imagemin-jpegtran');
var imageminOptipng = require('imagemin-optipng');
var imageminSvgo = require('imagemin-svgo');
var marked = require('marked');
var md5File = require('md5-file');
var nunjucks = require('nunjucks');
var nunjucksDate = require('nunjucks-date');
var nunjucksMarkdown = require('nunjucks-markdown');
var psi = require('psi');
var runSequence = require('run-sequence');
var shortid = require('shortid');
var argv = require('yargs').argv;

//
// Setup
//

// Get config data from package.json
var pkg = require('./package.json');
var appData = pkg.mylly || {};
var pathSrc = appData.src || './src';
var pathDist = appData.dist || './dist';

// Is the server currently active?
var isServing = false;

// Create nunjucks instance.
var nunjucksInst = nunjucks.configure(pathSrc, {
  autoescape: true,
  noCache: true,
  watch: false
});

// Register nunjucks markdown extension.
nunjucksMarkdown.register(nunjucksInst, marked);

// Register nunjucks date extension.
nunjucksDate.install(nunjucksInst);

//
// Helpers
//

function pathExists(filePath) {
  try {
    var stat = fs.statSync(filePath);
    return stat.isFile() || stat.isDirectory();
  }
  catch (err) {
    return false;
  }
}

function forceRequire(filePath) {
  delete require.cache[path.resolve(filePath)];
  return require(filePath);
}

function getFileData(filePath) {
  return pathExists(filePath) ? forceRequire(filePath) : {};
}

function getTemplateContext(file) {
  return Object.assign({}, getFileData(path.normalize(file.path).replace(/\.[^/.]+$/, '.ctx.js')));
}

//
// Tasks
//

var tasks = module.exports = [];

tasks.push({
  name: 'mylly:build:lint-js',
  fn: function (cb) {
    if (appData.eslintConfig) {
      return gulp.src([pathSrc + '/**/*.js', '!vendor/**/*.js'])
        .pipe(gulpEslint({
          configFile: appData.eslintConfig
        }))
        .pipe(gulpEslint.format())
        .pipe(gulpEslint.failAfterError());
    }
    else {
      cb();
    }
  }
});

tasks.push({
  name: 'mylly:build:lint-sass',
  fn: function (cb) {
    if (appData.sasslintConfig) {
      return gulp.src(pathSrc + '/**/*.s+(a|c)ss')
        .pipe(gulpSassLint({
          configFile: appData.sasslintConfig
        }))
        .pipe(gulpSassLint.format())
        .pipe(gulpSassLint.failOnError());
    }
    else {
      cb();
    }
  }
});

tasks.push({
  name: 'mylly:build:purge',
  fn: function (cb) {
    del.sync([pathDist + '/**/*', '!' + pathDist], {force: true});
    cb();
  }
});

tasks.push({
  name: 'mylly:build:init',
  fn: function () {
    return gulp.src([
          pathSrc + '/**/*',
          '!/**/*.html',
          '!/**/*.ctx.js',
          '!/**/*.s+(a|c)ss'
        ]
        .concat(appData.eslintConfig ? '!' + appData.eslintConfig : [])
        .concat(appData.sasslintConfig ? '!' + appData.sasslintConfig : [])
      )
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:compile-templates',
  fn: function (cb) {
    return gulp.src(pathSrc + '/**/[^_]*.html', {base: pathSrc})
      .pipe(gulpChange(function () {
        return nunjucksInst.render(path.relative(pathSrc, this.file.path), getTemplateContext(this.file));
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:compile-sass',
  fn: function () {
    return gulp.src(pathSrc + '/**/*.s+(a|c)ss', {base: pathSrc})
      .pipe(gulpSass({
        indentType: 'space',
        indentWidth: 2,
        outputStyle: 'expanded',
        precision: 10
      }).on('error', gulpSass.logError))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:minify-js',
  fn: function () {
    return gulp.src(pathDist + '/**/*.js', {base: pathDist})
      .pipe(gulpUglify({
        mangle: true,
        preserveComments: 'license',
        compress: {
          dead_code: false,
          hoist_funs: false,
          hoist_vars: false,
          cascade: false,
          side_effects: false
        }
      }))
      .pipe(gulpRename(function (path) {
        path.extname = path.extname.replace('.js', '.min.js');
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:minify-css',
  fn: function () {
    return gulp.src(pathDist + '/**/*.css', {base: pathDist})
      .pipe(gulpCleanCss({
        roundingPrecision: -1
      }))
      .pipe(gulpRename(function (path) {
        path.extname = path.extname.replace('.css', '.min.css');
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:create-bundles',
  fn: function (cb) {
    return gulp.src(pathDist + '/**/*.html', {base: pathDist})
      .pipe(gulpUseref({
        searchPath: pathDist,
        transformPath: function(filePath) {
          filePath = filePath.split('?')[0];
          filePath = filePath.replace('.js', '.min.js');
          filePath = filePath.replace('.css', '.min.css');
          return filePath;
        }
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:optimize-images',
  fn: function () {
    return gulp.src(pathSrc + '/**/*.{jpg,png,gif,svg}', {base: pathSrc})
      .pipe(gulpImagemin([
        imageminGifsicle(),
        imageminJpegtran(),
        imageminOptipng(),
        imageminSvgo()
      ]))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:sitemap',
  fn: function (cb) {
    if (appData.sitemap) {
      return gulp.src(pathDist + '/**/*.html', {base: pathDist})
        .pipe(gulpSitemap({
          siteUrl: appData.url || '',
          spacing: '  '
        }))
        .pipe(gulp.dest(pathDist));
    }
    else {
      cb();
    }
  }
});

tasks.push({
  name: 'mylly:build:revision',
  fn: function (cb) {
    var rev = shortid.generate();
    return gulp.src(pathDist + '/**/*.{html,js,css}', {base: pathDist})
      // First revision with a static revision number.
      .pipe(gulpReplace(/\?rev(.*?)\?/g, function (match, group) {
        return '?rev' + rev + '?';
      }))
      // Try to revision with the file's hash if possible.
      .pipe(gulpReplace(/\/static\/(.*?)\?rev(.*?)\?/g, function (match, group) {
        var filePath = match.split('?')[0];
        try {
          var hash = md5File.sync('.' + filePath);
          return filePath + '?rev' + hash + '?';
        }
        catch (e) {
          return match;
        }
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build:minify-html',
  fn: function () {
    return gulp.src(pathDist + '/**/*.html', {base: pathDist})
      .pipe(gulpChange(function (contents) {
        return htmlclean(contents);
      }))
      .pipe(gulp.dest(pathDist));
  }
});

tasks.push({
  name: 'mylly:build',
  fn: function (cb) {
    if (argv.dev) {
      runSequence(
        'mylly:build:lint-js',
        'mylly:build:lint-sass',
        'mylly:build:purge',
        'mylly:build:init',
        'mylly:build:compile-templates',
        'mylly:build:compile-sass',
        'mylly:build:revision',
        cb
      );
    }
    else {
      runSequence(
        'mylly:build:lint-js',
        'mylly:build:lint-sass',
        'mylly:build:purge',
        'mylly:build:init',
        'mylly:build:compile-templates',
        'mylly:build:compile-sass',
        'mylly:build:minify-js',
        'mylly:build:minify-css',
        'mylly:build:create-bundles',
        'mylly:build:optimize-images',
        'mylly:build:sitemap',
        'mylly:build:revision',
        'mylly:build:minify-html',
        cb
      );
    }
  }
});

tasks.push({
  name: 'mylly:watch',
  fn: function () {
    return gulpWatch(pathSrc + '/**/*', {
        ignoreInitial: true,
        verbose: true,
        events: ['add', 'change', 'unlink', 'addDir', 'unlinkDir']
      }, function () {
        runSequence('mylly:build', function () {
          if (isServing && argv.livereload) {
            browserSync.reload();
          }
        });
      });
  }
});

tasks.push({
  name: 'mylly:serve',
  fn: function () {
    isServing = true;
    runSequence('mylly:watch');
    browserSync.init({
      server: {
        baseDir: pathDist
      },
      injectChanges: false
    });
  }
});

tasks.push({
  name: 'mylly:size',
  fn: function () {
    var ret = gulp.src(pathDist + '/**/*').pipe(gulpSize());
    ['js', 'css', 'html', 'jpg', 'png', 'gif', 'svg'].forEach(function (fileType) {
      var filter = gulpFilter('**/*.' + fileType, {restore: true});
      ret = ret.pipe(filter).pipe(gulpSize({title: fileType})).pipe(filter.restore);
    });
    return ret;
  }
});

tasks.push({
  name: 'mylly:psi',
  fn: function (cb) {
    if (appData.url) {
      if (argv.all) {
        var pages = [];
        gulp.src(pathDist + '/**/*.html')
        .pipe(gulpChange(function (contents) {
          pages.push(psi.output(appData.url + '/' + this.file.relative, {
            nokey: true,
            strategy: argv.mobile ? 'mobile' : 'desktop'
          }));
        }));
        Promise.all(pages).then(function () {
          cb();
        });
      }
      else {
        var page = argv.page ? '/' + argv.page : '';
        return psi.output(appData.url + page, {
          nokey: true,
          strategy: argv.mobile ? 'mobile' : 'desktop'
        });
      }
    }
    else {
      console.log('No site url defined.');
      cb();
    }
  }
});

tasks.push({
  name: 'mylly:audit',
  fn: function () {
    return gulp.src(pathDist + '/**/*.html')
      .pipe(gulpA11y({
        viewportSize: argv.size ? size : '1920x1080',
        delay: 1
      }))
      .pipe(gulpA11y.reporter());
  }
});