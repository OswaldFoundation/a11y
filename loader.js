/* global console, module, alert, define, Promise, setImmediate, loadJS */

/*

promise-polyfill
https://github.com/taylorhakes/promise-polyfill

Copyright (c) 2014 Taylor Hakes
Copyright (c) 2014 Forbes Lindesay

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

(function (root) {

	// Store setTimeout reference so promise-polyfill will be unaffected by
	// other code modifying setTimeout (like sinon.useFakeTimers())
	var setTimeoutFunc = setTimeout;

	function noop() {}
	
	// Polyfill for Function.prototype.bind
	function bind(fn, thisArg) {
		return function () {
			fn.apply(thisArg, arguments);
		};
	}

	function Promise(fn) {
		this._state = 0;
		this._handled = false;
		this._value = undefined;
		this._deferreds = [];

		doResolve(fn, this);
	}

	function handle(self, deferred) {
		while (self._state === 3) {
			self = self._value;
		}
		if (self._state === 0) {
			self._deferreds.push(deferred);
			return;
		}
		self._handled = true;
		Promise._immediateFn(function () {
			var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;
			if (cb === null) {
				(self._state === 1 ? resolve : reject)(deferred.promise, self._value);
				return;
			}
			var ret;
			try {
				ret = cb(self._value);
			} catch (e) {
				reject(deferred.promise, e);
				return;
			}
			resolve(deferred.promise, ret);
		});
	}

	function resolve(self, newValue) {
		try {
			if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
				var then = newValue.then;
				if (newValue instanceof Promise) {
					self._state = 3;
					self._value = newValue;
					finale(self);
					return;
				} else if (typeof then === 'function') {
					doResolve(bind(then, newValue), self);
					return;
				}
			}
			self._state = 1;
			self._value = newValue;
			finale(self);
		} catch (e) {
			reject(self, e);
		}
	}

	function reject(self, newValue) {
		self._state = 2;
		self._value = newValue;
		finale(self);
	}

	function finale(self) {
		if (self._state === 2 && self._deferreds.length === 0) {
			Promise._immediateFn(function() {
				if (!self._handled) {
					Promise._unhandledRejectionFn(self._value);
				}
			});
		}

		for (var i = 0, len = self._deferreds.length; i < len; i++) {
			handle(self, self._deferreds[i]);
		}
		self._deferreds = null;
	}

	function Handler(onFulfilled, onRejected, promise) {
		this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
		this.onRejected = typeof onRejected === 'function' ? onRejected : null;
		this.promise = promise;
	}

	/**
	 * Take a potentially misbehaving resolver function and make sure
	 * onFulfilled and onRejected are only called once.
	 *
	 * Makes no guarantees about asynchrony.
	 */
	function doResolve(fn, self) {
		var done = false;
		try {
			fn(function (value) {
				if (done) { return; }
				done = true;
				resolve(self, value);
			}, function (reason) {
				if (done) { return; }
				done = true;
				reject(self, reason);
			});
		} catch (ex) {
			if (done) { return; }
			done = true;
			reject(self, ex);
		}
	}

	Promise.prototype['catch'] = function (onRejected) {
		return this.then(null, onRejected);
	};

	Promise.prototype.then = function (onFulfilled, onRejected) {
		var prom = new (this.constructor)(noop);

		handle(this, new Handler(onFulfilled, onRejected, prom));
		return prom;
	};

	Promise.all = function (arr) {
		var args = Array.prototype.slice.call(arr);

		return new Promise(function (resolve, reject) {
			if (args.length === 0) { return resolve([]); }
			var remaining = args.length;

			function res(i, val) {
				try {
					if (val && (typeof val === 'object' || typeof val === 'function')) {
						var then = val.then;
						if (typeof then === 'function') {
							then.call(val, function (val) {
								res(i, val);
							}, reject);
							return;
						}
					}
					args[i] = val;
					if (--remaining === 0) {
						resolve(args);
					}
				} catch (ex) {
					reject(ex);
				}
			}

			for (var i = 0; i < args.length; i++) {
				res(i, args[i]);
			}
		});
	};

	Promise.resolve = function (value) {
		if (value && typeof value === 'object' && value.constructor === Promise) {
			return value;
		}

		return new Promise(function (resolve) {
			resolve(value);
		});
	};

	Promise.reject = function (value) {
		return new Promise(function (resolve, reject) {
			reject(value);
		});
	};

	Promise.race = function (values) {
		return new Promise(function (resolve, reject) {
			for (var i = 0, len = values.length; i < len; i++) {
				values[i].then(resolve, reject);
			}
		});
	};

	// Use polyfill for setImmediate for performance gains
	Promise._immediateFn = (typeof setImmediate === 'function' && function (fn) { setImmediate(fn); }) ||
		function (fn) {
			setTimeoutFunc(fn, 0);
		};

	Promise._unhandledRejectionFn = function _unhandledRejectionFn(err) {
		if (typeof console !== 'undefined' && console) {
			console.warn('Possible Unhandled Promise Rejection:', err); // eslint-disable-line no-console
		}
	};

	/**
	 * Set the immediate function to execute callbacks
	 * @param fn {function} Function to execute
	 * @deprecated
	 */
	Promise._setImmediateFn = function _setImmediateFn(fn) {
		Promise._immediateFn = fn;
	};

	/**
	 * Change the function to execute on unhandled rejection
	 * @param {function} fn Function to execute on unhandled rejection
	 * @deprecated
	 */
	Promise._setUnhandledRejectionFn = function _setUnhandledRejectionFn(fn) {
		Promise._unhandledRejectionFn = fn;
	};
	
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = Promise;
	} else if (!root.Promise) {
		root.Promise = Promise;
	}

})(this);

/*

load-js
https://github.com/MiguelCastillo/load-js

Copyright (c) 2016 Miguel Castillo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

(function(global, factory) {
	if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
		// CommonJS support
		module.exports = factory();
	} else if (typeof define === "function" && define.amd) {
		// Do AMD support
		define(["loadJS"], factory);
	} else {
		// Do browser support
		global.loadJS = factory();
	}
})(this, function() {
	var cache = {};
	var head = document.getElementsByTagName("head")[0] || document.documentElement;

	function exec(options) {
		if (typeof options === "string") {
			options = {
				url: options
			};
		}

		var cacheId = options.id || options.url;
		var cacheEntry = cache[cacheId];

		if (cacheEntry) {
			//console.log("load-js: cache hit", cacheId);
			return cacheEntry;
		}
		else if (options.allowExternal !== false) {
			var el = getScriptById(options.id) || getScriptByUrl(options.url);

			if (el) {
				var promise = Promise.resolve(el);

				if (cacheId) {
					cache[cacheId] = promise;
				}

				return promise;
			}
		}

		var pending = (options.url ? loadScript : runScript)(head, createScript(options));

		if (cacheId && options.cache !== false) {
			cache[cacheId] = pending;
		}

		return pending;
	}

	function runScript(head, script) {
		head.appendChild(script);
		return Promise.resolve(script);
	}

	function loadScript(head, script) {
		return new Promise(function(resolve, reject) {
			// Handle Script loading
			var done = false;

			// Attach handlers for all browsers.
			//
			// References:
			// http://stackoverflow.com/questions/4845762/onload-handler-for-script-tag-in-internet-explorer
			// http://stevesouders.com/efws/script-onload.php
			// https://www.html5rocks.com/en/tutorials/speed/script-loading/
			//
			script.onload = script.onreadystatechange = function() {
				if (!done && (!script.readyState || script.readyState === "loaded" || script.readyState === "complete")) {
					done = true;

					// Handle memory leak in IE
					script.onload = script.onreadystatechange = null;
					resolve(script);
				}
			};

			script.onerror = reject;

			head.appendChild(script);
		});
	}

	function createScript(options) {
		var script = document.createElement("script");
		script.charset = options.charset || "utf-8";
		script.type = options.type || "text/javascript";
		script.async = !!options.async;
		script.id = options.id || options.url;
		script.loadJS = "watermark";

		if (options.url) {
			script.src = options.url;
		}

		if (options.text) {
			script.text = options.text;
		}

		return script;
	}

	function getScriptById(id) {
		var script = id && document.getElementById(id);

		if (script && script.loadJS !== "watermark") {
			console.warn("load-js: duplicate script with id:", id);
			return script;
		}
	}

	function getScriptByUrl(url) {
		var script = url && document.querySelector("script[src='" + url + "']");

		if (script && script.loadJS !== "watermark") {
			console.warn("load-js: duplicate script with url:", url);
			return script;
		}
	}

	return function load(items) {
		return items instanceof Array ?
			Promise.all(items.map(exec)) :
			exec(items);
	};
});

/*

Web accessibility widget loader

Copyright (c) 2017 Oswald Foundation
Copyright (c) 2017 Anand Chowdhary

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

(function() {
	
	// Initialize variables
	if (window.a11y) {
		window.a11y.created = 0;
		window.a11y.loaded = 0;
		window.a11y.opened  = 0;
	} else {
		window.a11y = {
			created: 0,
			loaded: 0,
			opened: 0
		};
	}
	var a = window.a11y;
	
	function loadStyles(css) {
		var s = document.querySelector("#a11ystyles");
		if (!s) {
			s = document.createElement("style");
			s.setAttribute("type", "text/css");
			s.setAttribute("id", "a11ystyles");
			(document.head || document.documentElement).appendChild(s);
		}
		s.innerHTML += css;
	}

	// Create window
	var widget = document.createElement("div");
	widget.classList.add("a11ywidget");
	document.body.appendChild(widget);
	a.widget = widget;
	var widgetBG = document.createElement("div");
	widgetBG.classList.add("a11ywidget_bg");
	document.body.appendChild(widgetBG);
	loadStyles(".a11ywidget,.a11ywidget_bg{position:fixed;display:none;transition:.3s}.a11ywidget{overflow:auto;opacity:0;background:#fff;border-radius:8px;box-shadow:0 5px 40px rgba(0,0,0,.16);width:350px;max-width:80vw;height:450px;max-height:70vh;z-index:5762342}.a11ywidget.animate-bottom{transform:translateY(30px)}.a11ywidget.animate-top{transform:translateY(-30px)}.a11ywidget.open{transform:translate(0,0);opacity:1}.a11ywidget_bg{z-index:134223;opacity:0;width:500px;height:500px;background:radial-gradient(ellipse at bottom right,rgba(29,39,54,.16) 0,rgba(29,39,54,0) 72%)}.a11ywidget_bg.open{opacity:1}@media (max-width:500px){.a11ywidget{width:100%!important;left:0!important;right:0!important;top:0!important;height:auto!important;max-width:none;border-radius:0;max-height:none}}");

	if (a.created !== 1) {
		// Check if button mode
		if (a.button) {
			var button = document.createElement("button");
			button.style.webkitAppearance = "none";
			button.style.border = "none";
			document.body.appendChild(button);
			switch (a.button) {
				case "circle":
					button.style.padding = "7px";
					button.style.backgroundColor = a.color ? a.color : "#444";
					var image = document.createElement("img");
					image.setAttribute("src", a.image ? a.image : "https://cdn.oswald.foundation/5cabb-noun_1872.svg");
					if (!a.image) {
						if (a.theme) {
							if (a.theme === "dark") {
								image.style.filter = "invert(1)";
								a.inverted = 1;
							}
						} else {
							image.style.filter = "invert(1)";
							a.inverted = 1;
						}
					}
					image.setAttribute("alt", "Accessibility icon");
					image.style.width = "100%";
					button.appendChild(image);
					button.style.width = a.width ? a.width : "50px";
					button.style.height = a.height ? a.height : "50px";
					button.style.borderRadius = "100%";
					break;
			}
			if (a.button && a.xPosition && a.yPosition) {
				button.classList.add("a11y-floating-button");
				loadStyles(".a11y-floating-button{transition:.3s;opacity:0;transform:scale(0.8);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.06),0 2px 32px rgba(0,0,0,.16)}.a11y-floating-button:hover{box-shadow:0 2px 8px rgba(0,0,0,.09),0 4px 40px rgba(0,0,0,.24)!important}.a11y-animate-rotate{animation:a11y-spin .6s infinite linear}@keyframes a11y-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}");
				button.style.position = "fixed";
				button.style.zIndex = "8954303923";
				setTimeout(function() {
					button.style.opacity = "1";
					button.style.transform = "scale(1)";
				}, 1);
				if (a.xPosition === "right") {
					button.style.right = "20px";
					widget.style.right = "20px";
					widgetBG.style.right = "0";
				} else if (a.xPosition === "left") {
					button.style.left = "20px";
					widget.style.left = "20px";
					widgetBG.style.left = "0";
				} else {
					button.style.left = a.xPosition + "px";
					widget.style.left = a.xPosition + "px";
					widgetBG.style.left = a.xPosition + "px";
				}
				if (a.yPosition === "top") {
					widget.classList.add("animate-top");
					button.style.top = "20px";
					widget.style.top = (parseInt(button.style.top) + button.offsetHeight + 20) + "px";
					widgetBG.style.top = "0";
				} else if (a.yPosition === "bottom") {
					widget.classList.add("animate-bottom");
					button.style.bottom = "20px";
					widget.style.bottom = (parseInt(button.style.bottom) + button.offsetHeight + 20) + "px";
					widgetBG.style.bottom = "0";
				} else {
					widgetBG.style.top = a.yPosition + "px";
					button.style.top = a.yPosition + "px";
				}
			}
			button.addEventListener("click", function() {
				if (window.a11y.opened === 1) {
					image.setAttribute("src", "https://cdn.anandchowdhary.com/a11yicon.svg");
					closeWidget();
				} else {
					image.setAttribute("src", "https://cdn.anandchowdhary.com/loader.svg");
					image.classList.add("a11y-animate-rotate");
					loadAgastya().then(function() {
						image.setAttribute("src", "https://cdn.anandchowdhary.com/closeicon.svg");
						image.classList.remove("a11y-animate-rotate");
						window.a11y.opened = 1;
					}, function(error) {
						image.setAttribute("src", "https://cdn.oswald.foundation/2y7r9q-error.svg");
						image.classList.remove("a11y-animate-rotate");
						console.error(error);
						alert(error);
					});
				}
			});
		// Defaults if no button
		} else {
			widget.classList.add("default");
			loadStyles(".a11ywidget.default{left:50%;top:50%;transform:translate(-50%,-40%)}.a11ywidget.default.open{transform:translate(-50%,-50%)}.a11ywidget_lightbox{position:fixed;z-index:328937;left:0;right:0;top:0;bottom:0;background:rgba(50,50,50,.1);display:none;opacity:0;transition:.3s}.a11ywidget_lightbox.open{opacity:1}");
			widgetBG.style.bottom = 0;
			widgetBG.style.left = "50%";
			widgetBG.style.transform = "translateX(-50%)";
			widgetBG.style.background = "radial-gradient(ellipse at bottom center, rgba(29, 39, 54, .16) 0, rgba(29, 39, 54, 0) 72%)";
			var widgetLB = document.createElement("div");
			widgetLB.classList.add("a11ywidget_lightbox");
			document.body.appendChild(widgetLB);
		}
		window.a11y.created = 1;
	}

	// Open/close functions
	function closeWidget() {
		widget.classList.remove("open");
		widgetBG.classList.remove("open");
		setTimeout(function() {
			widget.style.display = "none";
			widgetBG.style.display = "none";
		}, 300);
		window.a11y.opened = 0;
	}
	function openWidget() {
		widget.style.display = "block";
		widgetBG.style.display = "block";
		if (document.querySelector(".a11ywidget_lightbox")) {
			document.querySelector(".a11ywidget_lightbox").style.display = "block";
		}
		setTimeout(function() {
			widget.classList.add("open");
			widgetBG.classList.add("open");
			if (document.querySelector(".a11ywidget_lightbox")) {
				document.querySelector(".a11ywidget_lightbox").classList.add("open");
			}
		}, 1);
		window.a11y.loaded = 1;
	}

	// Add to buttons
	function initWidget() {
		var allButtons = document.querySelectorAll("[data-a11y]");
		for (var i = 0; i < allButtons.length; i++) {
			/* jshint ignore:start */
			allButtons[i].addEventListener("click", function() {
				window.a11y.openWidget();
			});
			/* jshint ignore:end */
		}
	}
	initWidget();

	// Global functions
	window.a11y.openWidget = function() {
		loadAgastya().then(function() {
			//console.log("OK LOADED");
		});
	};

	function loadAgastya() {
		return new Promise(function(resolve, reject) {
			if (window.a11y.loaded === 0) {
				setTimeout(function() {
					loadJS(["widget-min.js"]).then(function() {
						openWidget();
						resolve("Loaded");
					}, function() {
						reject(Error("Unable to load accessibility options"));
					});
				}, 500);
			} else {
				openWidget();
				resolve("Loaded");
			}
		});
	}

})();