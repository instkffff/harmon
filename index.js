var trumpet = require('trumpet');
var zlib = require('zlib');
var { ServerResponse } = require('http');


/* Determine if this is a request for HTML and cache the result */
ServerResponse.prototype.__harmon_isHtml = function () {
  if (this.__harmon__isHtml === undefined) {
    var contentType = this.getHeader('content-type') || '';
    this.__harmon__isHtml = contentType.indexOf('text/html') === 0;
  }

  return this.__harmon__isHtml;
}

/* Determine if this is a request for compressed content and cache the result */
ServerResponse.prototype.__harmon_isGzipped = function () {
  if (this.__harmon__isGzipped === undefined) {
    var encoding = this.getHeader('content-encoding') || '';
    this.__harmon__isGzipped = encoding.toLowerCase() === 'gzip' && this.__harmon_isHtml();
  }

  return this.__harmon__isGzipped;
}


module.exports = function harmonBinary(reqSelectors, resSelectors, htmlOnly) {
  var _reqSelectors = reqSelectors || [];
  var _resSelectors = resSelectors || [];
  var _htmlOnly     = (typeof htmlOnly == 'undefined') ? false : htmlOnly;

  function prepareResponseSelectors(req, res) {
    var tr          = trumpet();
    var _write      = res.write;
    var _end        = res.end;
    var _writeHead  = res.writeHead;
    var gunzip      = zlib.Gunzip();

    prepareSelectors(tr, _resSelectors, req, res);

    res.writeHead = function () {
      // writeHead supports (statusCode, headers) as well as (statusCode, statusMessage, headers)
      var headers = (arguments.length > 2) ? arguments[2] : arguments[1];
      headers = headers || {};

      /* Sniff out the content-type header.
       * If the response is HTML, we're safe to modify it.
       */
      if (!_htmlOnly && res.__harmon_isHtml()) {
        res.removeHeader('Content-Length');
        delete headers['content-length'];
      }

      /* Sniff out the content-encoding header.
       * If the response is Gziped, we have to gunzip content before and ungzip after.
       */
      if (res.__harmon_isGzipped()) {
        res.removeHeader('Content-Encoding');
        delete headers['content-encoding'];
      }

      _writeHead.apply(res, arguments);
    };

    res.write = function (data, encoding) {
      // Only run data through trumpet if we have HTML
      if (res.__harmon_isHtml()) {
        if (res.__harmon_isGzipped()) {
          gunzip.write(data);
        } else {
          tr.write(data, encoding);
        }
      } else {
        _write.apply(res, arguments);
      }
    };

    res.end = function (data, encoding) {
      if (res.__harmon_isGzipped()) {
        gunzip.end(data);
      } else {
        tr.end(data, encoding);
      }
    };

    tr.on('data', function (buf) {
      _write.call(res, buf);
    });

    tr.on('end', function () {
      _end.call(res);
    });

    gunzip.on('data', function (buf) {
      tr.write(buf);
    });

    gunzip.on('end', function (data) {
      tr.end(data);
    });
  }

  function prepareSelectors(tr, selectors, req, res) {
    for (var i = 0; i < selectors.length; i++) {
      (function (callback, req, res) {
        var callbackInvoker  = function(element) {
          callback(element, req, res);
        };

        tr.selectAll(selectors[i].query, callbackInvoker);
      })(selectors[i].func, req, res);
    }
  }

  return function harmonBinary(req, res, next) {
    var ignore = false;

    if (_htmlOnly) {
      var lowercaseUrl = req.url.toLowerCase();

      if ((lowercaseUrl.indexOf('.js', req.url.length - 3) !== -1) ||
          (lowercaseUrl.indexOf('.css', req.url.length - 4) !== -1)) {
        ignore = true;
      }
    }

    if (!ignore) {
      if (_reqSelectors.length) {
        prepareRequestSelectors(req, res);
      }

      if (_resSelectors.length) {
        prepareResponseSelectors(req, res);
      }
    }

    next();
  };
};
