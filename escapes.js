//
//                                                   _)
//     _ \   __|   __|   _` |  __ \    _ \   __|     |   __|
//     __/ \__ \  (     (   |  |   |   __/ \__ \     | \__ \
//   \___| ____/ \___| \__,_|  .__/  \___| ____/ _)  | ____/
//                            _|                 ___/
//

//  escapes.js
//  http://github.com/atdt/escapes.js
//  Copyright (C) 2012 Ori Livneh
//
//  This program is free software; you can redistribute it and/or
//  modify it under the terms of the GNU General Public License
//  as published by the Free Software Foundation; either version 2
//  of the License, or (at your option) any later version.
//
//  This program is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU General Public License for more details.

/*jslint bitwise: true, browser: true, plusplus: true, unparam: true */
/*globals escapes: true */

// greetz to deniz.

(function (exports) {
    "use strict";
    var escapes,

        BLACK   = 0,
        RED     = 1,
        GREEN   = 2,
        YELLOW  = 3,
        BLUE    = 4,
        MAGENTA = 5,
        CYAN    = 6,
        WHITE   = 7,

        NONE      = 0x0,
        BRIGHT    = 0x1,
        UNDERLINE = 0x4,
        BLINK     = 0x5,
        REVERSE   = 0x7,
        INVISIBLE = 0x9,

// Colors expressed as RGBA arrays

        COLORS = [
            [  0,   0,   0, 255],    // Black
            [170,   0,   0, 255],    // Red
            [  0, 170,   0, 255],    // Green
            [170,  85,   0, 255],    // Yellow
            [  0,   0, 170, 255],    // Blue
            [170,   0, 170, 255],    // Magenta
            [  0, 170, 170, 255],    // Cyan
            [170, 170, 170, 255]     // White
        ],

        MAX_HEIGHT = 4000,  // px.

        font;

    function Canvas(width, height) {
        var canvas = document.createElement('canvas');

        canvas.width  = width  || 640;
        canvas.height = height || MAX_HEIGHT;

        return canvas;
    }

    function getColor(code, bright) {
        var rgba = COLORS[code];

// The bright version of each color adds 85 to each color channel

        if (bright) {
            rgba = rgba.slice(0);
            rgba[0] += 85;
            rgba[1] += 85;
            rgba[2] += 85;
        }
        return rgba;
    }

    function binaryGet(url, success, error) {
        var DONE = 4,
            OK = 200,
            req;

        req = new window.XMLHttpRequest();
        req.overrideMimeType('text/plain; charset=x-user-defined');
        req.onreadystatechange = function () {
            if (req.readyState === DONE) {
                if (req.status === OK) {
                    success(req.responseText);
                } else if (typeof error !== undefined) {
                    error(req);
                }
            }
        };
        req.open('GET', url, true);
        req.send(null);
    }

    function parseIntArray(array) {
        var i = array.length;
        while (i--) {
            array[i] = parseInt(array[i], 10);
        }
        return array;
    }

    function Cursor() {
        if (!(this instanceof Cursor)) {
            return new Cursor();
        }

        // Canvas
        this.canvas  = new Canvas();
        this.context = this.canvas.getContext('2d');
        this.bitmap  = this.context.createImageData(8, 16);

        // Position
        this.column     = 1;
        this.row        = 1;
        this.scrollback = 0;

        // Graphic mode
        this.foreground = WHITE;
        this.background = BLACK;
        this.flags      = 0x0;

        return this;
    }

    Cursor.prototype = {

        draw: function (url, callback) {
            var cursor = new Cursor();

            binaryGet(url, function (data) {
                cursor.parse(data, {
                    onEscape    : cursor.escape,
                    onLiteral   : cursor.write,
                    onComplete  : callback
                });
            });

            return cursor;
        },

        moveCursorBy: function (columns, rows) {
            this.column += columns;
            this.row += rows;

// If the requested movement pushed the cursor out of bounds, return cursor to
// boundary.

            this.column = Math.max(this.column, 1);
            this.column = Math.min(this.column, 80);
            this.row = Math.max(this.row, 1);
            this.row = Math.min(this.row, 25);
        },

        clearCanvas: function () {
            this.context.fillStyle = 'black';
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.flags = NONE;
            this.resetColor();
        },

        trimCanvas: function () {
            var height = (this.row + this.scrollback) * 16,
                image_data = this.context.getImageData(0, 0, this.canvas.width, height);

            this.canvas.height = height;
            this.clearCanvas();
            this.context.putImageData(image_data, 0, 0);
        },

        savePosition: function () {
            var self = this;
            self.saved = {
                column: self.column,
                row: self.row
            };
        },

        loadPosition: function () {
            this.column = this.saved.column;
            this.row = this.saved.row;
            delete this.saved;
        },

        resetColor: function () {
            this.foreground = WHITE;
            this.background = BLACK;
        },

// Draw a letterform on the buffer canvas using the specified foreground and
// background colors and return its pixel data.

        renderChar: function (charcode, foreground, background) {
            var letterform, x, y, i, row, offset, color, pixel_array;

            pixel_array = this.bitmap.data;
            letterform = font[charcode];

// Each letterform comprises sixteen bytes, with each byte representing a row
// of eight pixels.

            for (y = 0; y < 16; y++) {
                row = letterform[y] || 0x00;

// Individual bits are either filled in (1) or empty (0). To get a value for
// each pixel, we shift bits to the right, one at a time.

                for (x = 7; x >= 0; x--) {
                    offset = (4 * x) + (32 * y);
                    color = row & 1 ? foreground : background;

// Each pixel is represented by four array elements, representing the intensity
// of the red, green, blue, and alpha channels, respectively.

                    for (i = 0; i < 4; i++) {
                        pixel_array[offset + i] = color[i];
                    }
                    row >>= 1;
                }
            }
            return this.bitmap;
        },


// Iteratively parse a string of into literal text fragments and ANSI escapes

        parse: function (buffer, options) {
            var re = /(?:\x1b\x5b)([=;0-9]*?)([ABCDHJKfhlmnpsu])/g,
                pos = 0,
                opcode,
                args,
                match;

            do {
                pos = re.lastIndex;
                match = re.exec(buffer);

// If we found a match, and if the match is further ahead than our current
// position in the string, we can assume everything from the current position
// to the start of the match is literal text.

                if (match !== null) {
                    if (match.index > pos) {
                        this.write(buffer.slice(pos, match.index));
                    }

// Parse an escape sequence into a character opcode and an array of parameters

                    opcode = match[2];
                    args = parseIntArray(match[1].split(';'));
                    options.onEscape.call(this, opcode, args);
                }
            } while (re.lastIndex !== 0);

// Output the tail of the buffer (whatever follows the last escape sequence)

            if (pos < buffer.length) {
                options.onLiteral.call(this, buffer.slice(pos));
            }

            this.trimCanvas();

            options.onComplete.call(this, this.canvas);

            return this;
        },

        escape: function (opcode, args) {
            var arg, i, length;

            switch (opcode) {
            case 'A':  // Cursor Up
                arg = args[0] || 1;
                this.moveCursorBy(0, -arg);
                break;

            case 'B':  // Cursor Down
                arg = args[0] || 1;
                this.moveCursorBy(0, arg);
                break;

            case 'C':  // Cursor Forward
                arg = args[0] || 1;
                this.moveCursorBy(arg, 0);
                break;

            case 'D':  // Cursor Backward
                arg = args[0] || 1;
                this.moveCursorBy(-arg, 0);
                break;

            case 'f':  // Horizontal & Vertical Position
            case 'H':  // Cursor Position
                this.row = args[0] || 1;
                this.column = args[1] || 1;
                break;

            case 's':  // Save Cursor Position
                this.savePosition();
                break;

            case 'u':  // Restore Cursor Position
                this.loadPosition();
                break;

            case 'm':  // Set Graphics Rendition
                for (i = 0, length = args.length; i < length; i++) {
                    arg = args[i];
                    if (arg === NONE) {
                        this.flags = NONE;
                        this.resetColor();
                    } else {
                        switch (Math.floor(arg / 10)) {
                        case 0:
                            this.flags |= arg;
                            this.resetColor();
                            break;
                        case 3:
                            this.foreground = arg - 30;
                            break;
                        case 4:
                            this.background = arg - 40;
                            break;
                        }
                    }
                }
                break;

            case 'J':  // Erase Display
                if (args[0] === 2) {
                    this.flags = NONE;
                    this.resetColor();
                }
                break;

            case 'K':  // Erase Line
                (function (self) {
                    var x, y;

                    self.context.fillStyle = 'black';
                    y = (self.cursor.row + self.cursor.scrollback - 1) * 16;
                    x = (self.cursor.column - 1) * 8;
                    self.context.fillRect(x, y, 8, 16);
                }());
                break;
            }
        },

        write: function (text) {
            var CR = 0x0d,
                LF = 0x0a,
                cursor = this,
                image_data,
                background,
                foreground,
                charcode,
                x,
                y,
                i,
                length;

            foreground = getColor(this.foreground, this.flags & BRIGHT);
            background = getColor(this.background);

            for (i = 0, length = text.length; i < length; i++) {
                charcode = text.charCodeAt(i) & 0xff;
                switch (charcode) {
                case CR:
                    cursor.column = 1;
                    break;

                case LF:
                    cursor.row++;
                    break;

                default:
                    x = (cursor.column - 1) * 8;
                    y = (cursor.row + cursor.scrollback - 1) * 16;
                    image_data = this.renderChar(charcode, foreground, background);
                    this.context.putImageData(image_data, x, y);

                    if (cursor.column === 80) {
                        cursor.column = 1;
                        cursor.row++;
                    } else {
                        cursor.column++;
                    }
                    break;
                }

// The value of 'row' represents current position relative to the top of the
// screen and therefore cannot exceed 25. Vertical scroll past the 25th line
// increments the scrollback buffer instead.

                if (cursor.row === 26) {
                    cursor.scrollback++;
                    cursor.row--;
                }
            }
        },

    };

// Dump of bitmap VGA font. Each glyph in the ASCII set is an element in the
// array, indexed to its character code. Each 8px x 16px character is
// represented by a sixteen-element sub-array, with each element representing
// a row of pixels.

    font = [
        [    ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     , 0x7e, 0x81, 0xa5, 0x81, 0x81, 0xbd, 0x99, 0x81, 0x81, 0x7e,     ,     ,     ,     ],
        [    ,     , 0x7e, 0xff, 0xdb, 0xff, 0xff, 0xc3, 0xe7, 0xff, 0xff, 0x7e,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x6c, 0xfe, 0xfe, 0xfe, 0xfe, 0x7c, 0x38, 0x10,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x10, 0x38, 0x7c, 0xfe, 0x7c, 0x38, 0x10,     ,     ,     ,     ,     ],
        [    ,     ,     , 0x18, 0x3c, 0x3c, 0xe7, 0xe7, 0xe7, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     ,     , 0x18, 0x3c, 0x7e, 0xff, 0xff, 0x7e, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     , 0x18, 0x3c, 0x3c, 0x18,     ,     ,     ,     ,     ,     ],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0xc3, 0xc3, 0xe7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        [    ,     ,     ,     ,     , 0x3c, 0x66, 0x42, 0x42, 0x66, 0x3c,     ,     ,     ,     ,     ],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xc3, 0x99, 0xbd, 0xbd, 0x99, 0xc3, 0xff, 0xff, 0xff, 0xff, 0xff],
        [    ,     , 0x1e, 0x0e, 0x1a, 0x32, 0x78, 0xcc, 0xcc, 0xcc, 0xcc, 0x78,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x66, 0x66, 0x66, 0x66, 0x3c, 0x18, 0x7e, 0x18, 0x18,     ,     ,     ,     ],
        [    ,     , 0x3f, 0x33, 0x3f, 0x30, 0x30, 0x30, 0x30, 0x70, 0xf0, 0xe0,     ,     ,     ,     ],
        [    ,     , 0x7f, 0x63, 0x7f, 0x63, 0x63, 0x63, 0x63, 0x67, 0xe7, 0xe6, 0xc0,     ,     ,     ],
        [    ,     ,     , 0x18, 0x18, 0xdb, 0x3c, 0xe7, 0x3c, 0xdb, 0x18, 0x18,     ,     ,     ,     ],
        [    , 0x80, 0xc0, 0xe0, 0xf0, 0xf8, 0xfe, 0xf8, 0xf0, 0xe0, 0xc0, 0x80,     ,     ,     ,     ],
        [    , 0x02, 0x06, 0x0e, 0x1e, 0x3e, 0xfe, 0x3e, 0x1e, 0x0e, 0x06, 0x02,     ,     ,     ,     ],
        [    ,     , 0x18, 0x3c, 0x7e, 0x18, 0x18, 0x18, 0x7e, 0x3c, 0x18,     ,     ,     ,     ,     ],
        [    ,     , 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,     , 0x66, 0x66,     ,     ,     ,     ],
        [    ,     , 0x7f, 0xdb, 0xdb, 0xdb, 0x7b, 0x1b, 0x1b, 0x1b, 0x1b, 0x1b,     ,     ,     ,     ],
        [    , 0x7c, 0xc6, 0x60, 0x38, 0x6c, 0xc6, 0xc6, 0x6c, 0x38, 0x0c, 0xc6, 0x7c,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     , 0xfe, 0xfe, 0xfe, 0xfe,     ,     ,     ,     ],
        [    ,     , 0x18, 0x3c, 0x7e, 0x18, 0x18, 0x18, 0x7e, 0x3c, 0x18, 0x7e,     ,     ,     ,     ],
        [    ,     , 0x18, 0x3c, 0x7e, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18,     ,     ,     ,     ],
        [    ,     , 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e, 0x3c, 0x18,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x18, 0x0c, 0xfe, 0x0c, 0x18,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x30, 0x60, 0xfe, 0x60, 0x30,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     , 0xc0, 0xc0, 0xc0, 0xfe,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x28, 0x6c, 0xfe, 0x6c, 0x28,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x10, 0x38, 0x38, 0x7c, 0x7c, 0xfe, 0xfe,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0xfe, 0xfe, 0x7c, 0x7c, 0x38, 0x38, 0x10,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     , 0x18, 0x3c, 0x3c, 0x3c, 0x18, 0x18, 0x18,     , 0x18, 0x18,     ,     ,     ,     ],
        [    , 0x66, 0x66, 0x66, 0x24,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     , 0x6c, 0x6c, 0xfe, 0x6c, 0x6c, 0x6c, 0xfe, 0x6c, 0x6c,     ,     ,     ,     ],
        [0x18, 0x18, 0x7c, 0xc6, 0xc2, 0xc0, 0x7c, 0x06, 0x06, 0x86, 0xc6, 0x7c, 0x18, 0x18,     ,     ],
        [    ,     ,     ,     , 0xc2, 0xc6, 0x0c, 0x18, 0x30, 0x60, 0xc6, 0x86,     ,     ,     ,     ],
        [    ,     , 0x38, 0x6c, 0x6c, 0x38, 0x76, 0xdc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x30, 0x30, 0x30, 0x60,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     , 0x0c, 0x18, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x18, 0x0c,     ,     ,     ,     ],
        [    ,     , 0x30, 0x18, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x18, 0x30,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x66, 0x3c, 0xff, 0x3c, 0x66,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x18, 0x18, 0x7e, 0x18, 0x18,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     ,     , 0x18, 0x18, 0x18, 0x30,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0xfe,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     ,     ,     , 0x18, 0x18,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x02, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xc0, 0x80,     ,     ,     ,     ],
        [    ,     , 0x38, 0x6c, 0xc6, 0xc6, 0xd6, 0xd6, 0xc6, 0xc6, 0x6c, 0x38,     ,     ,     ,     ],
        [    ,     , 0x18, 0x38, 0x78, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xc0, 0xc6, 0xfe,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0x06, 0x06, 0x3c, 0x06, 0x06, 0x06, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x0c, 0x1c, 0x3c, 0x6c, 0xcc, 0xfe, 0x0c, 0x0c, 0x0c, 0x1e,     ,     ,     ,     ],
        [    ,     , 0xfe, 0xc0, 0xc0, 0xc0, 0xfc, 0x06, 0x06, 0x06, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x38, 0x60, 0xc0, 0xc0, 0xfc, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0xfe, 0xc6, 0x06, 0x06, 0x0c, 0x18, 0x30, 0x30, 0x30, 0x30,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0x7e, 0x06, 0x06, 0x06, 0x0c, 0x78,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x18, 0x18,     ,     ,     , 0x18, 0x18,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x18, 0x18,     ,     ,     , 0x18, 0x18, 0x30,     ,     ,     ,     ],
        [    ,     ,     , 0x06, 0x0c, 0x18, 0x30, 0x60, 0x30, 0x18, 0x0c, 0x06,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7e,     ,     , 0x7e,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     , 0x60, 0x30, 0x18, 0x0c, 0x06, 0x0c, 0x18, 0x30, 0x60,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0x0c, 0x18, 0x18, 0x18,     , 0x18, 0x18,     ,     ,     ,     ],
        [    ,     ,     , 0x7c, 0xc6, 0xc6, 0xde, 0xde, 0xde, 0xdc, 0xc0, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x10, 0x38, 0x6c, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0xfc, 0x66, 0x66, 0x66, 0x7c, 0x66, 0x66, 0x66, 0x66, 0xfc,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x66, 0xc2, 0xc0, 0xc0, 0xc0, 0xc0, 0xc2, 0x66, 0x3c,     ,     ,     ,     ],
        [    ,     , 0xf8, 0x6c, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x6c, 0xf8,     ,     ,     ,     ],
        [    ,     , 0xfe, 0x66, 0x62, 0x68, 0x78, 0x68, 0x60, 0x62, 0x66, 0xfe,     ,     ,     ,     ],
        [    ,     , 0xfe, 0x66, 0x62, 0x68, 0x78, 0x68, 0x60, 0x60, 0x60, 0xf0,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x66, 0xc2, 0xc0, 0xc0, 0xde, 0xc6, 0xc6, 0x66, 0x3a,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     , 0x1e, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0xcc, 0xcc, 0xcc, 0x78,     ,     ,     ,     ],
        [    ,     , 0xe6, 0x66, 0x66, 0x6c, 0x78, 0x78, 0x6c, 0x66, 0x66, 0xe6,     ,     ,     ,     ],
        [    ,     , 0xf0, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x62, 0x66, 0xfe,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xee, 0xfe, 0xfe, 0xd6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xe6, 0xf6, 0xfe, 0xde, 0xce, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0xfc, 0x66, 0x66, 0x66, 0x7c, 0x60, 0x60, 0x60, 0x60, 0xf0,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xd6, 0xde, 0x7c, 0x0c, 0x0e,     ,     ],
        [    ,     , 0xfc, 0x66, 0x66, 0x66, 0x7c, 0x6c, 0x66, 0x66, 0x66, 0xe6,     ,     ,     ,     ],
        [    ,     , 0x7c, 0xc6, 0xc6, 0x60, 0x38, 0x0c, 0x06, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x7e, 0x7e, 0x5a, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x6c, 0x38, 0x10,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xd6, 0xd6, 0xd6, 0xfe, 0xee, 0x6c,     ,     ,     ,     ],
        [    ,     , 0xc6, 0xc6, 0x6c, 0x7c, 0x38, 0x38, 0x7c, 0x6c, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0x66, 0x66, 0x66, 0x66, 0x3c, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     , 0xfe, 0xc6, 0x86, 0x0c, 0x18, 0x30, 0x60, 0xc2, 0xc6, 0xfe,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3c,     ,     ,     ,     ],
        [    ,     ,     , 0x80, 0xc0, 0xe0, 0x70, 0x38, 0x1c, 0x0e, 0x06, 0x02,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x3c,     ,     ,     ,     ],
        [0x10, 0x38, 0x6c, 0xc6,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     , 0xff,     ,     ],
        [    , 0x30, 0x18, 0x0c,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     , 0xe0, 0x60, 0x60, 0x78, 0x6c, 0x66, 0x66, 0x66, 0x66, 0x7c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7c, 0xc6, 0xc0, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x1c, 0x0c, 0x0c, 0x3c, 0x6c, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7c, 0xc6, 0xfe, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x1c, 0x36, 0x32, 0x30, 0x78, 0x30, 0x30, 0x30, 0x30, 0x78,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x76, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x7c, 0x0c, 0xcc, 0x78,     ],
        [    ,     , 0xe0, 0x60, 0x60, 0x6c, 0x76, 0x66, 0x66, 0x66, 0x66, 0xe6,     ,     ,     ,     ],
        [    ,     , 0x18, 0x18,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     , 0x06, 0x06,     , 0x0e, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x66, 0x66, 0x3c,     ],
        [    ,     , 0xe0, 0x60, 0x60, 0x66, 0x6c, 0x78, 0x78, 0x6c, 0x66, 0xe6,     ,     ,     ,     ],
        [    ,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xec, 0xfe, 0xd6, 0xd6, 0xd6, 0xd6, 0xc6,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xdc, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xdc, 0x66, 0x66, 0x66, 0x66, 0x66, 0x7c, 0x60, 0x60, 0xf0,     ],
        [    ,     ,     ,     ,     , 0x76, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x7c, 0x0c, 0x0c, 0x1e,     ],
        [    ,     ,     ,     ,     , 0xdc, 0x76, 0x66, 0x60, 0x60, 0x60, 0xf0,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7c, 0xc6, 0x60, 0x38, 0x0c, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x10, 0x30, 0x30, 0xfc, 0x30, 0x30, 0x30, 0x30, 0x36, 0x1c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x6c, 0x38,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xc6, 0xc6, 0xd6, 0xd6, 0xd6, 0xfe, 0x6c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xc6, 0x6c, 0x38, 0x38, 0x38, 0x6c, 0xc6,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7e, 0x06, 0x0c, 0xf8,     ],
        [    ,     ,     ,     ,     , 0xfe, 0xcc, 0x18, 0x30, 0x60, 0xc6, 0xfe,     ,     ,     ,     ],
        [    ,     , 0x0e, 0x18, 0x18, 0x18, 0x70, 0x18, 0x18, 0x18, 0x18, 0x0e,     ,     ,     ,     ],
        [    ,     , 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18,     ,     ,     ,     ],
        [    ,     , 0x70, 0x18, 0x18, 0x18, 0x0e, 0x18, 0x18, 0x18, 0x18, 0x70,     ,     ,     ,     ],
        [    , 0x76, 0xdc,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x10, 0x38, 0x6c, 0xc6, 0xc6, 0xc6, 0xfe,     ,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x66, 0xc2, 0xc0, 0xc0, 0xc0, 0xc0, 0xc2, 0x66, 0x3c, 0x18, 0x70,     ,     ],
        [    ,     , 0xcc,     ,     , 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x0c, 0x18, 0x30,     , 0x7c, 0xc6, 0xfe, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x10, 0x38, 0x6c,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     , 0xcc,     ,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x60, 0x30, 0x18,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x38, 0x6c, 0x38,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7c, 0xc6, 0xc0, 0xc0, 0xc0, 0xc6, 0x7c, 0x18, 0x70,     ,     ],
        [    , 0x10, 0x38, 0x6c,     , 0x7c, 0xc6, 0xfe, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0xc6,     ,     , 0x7c, 0xc6, 0xfe, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x60, 0x30, 0x18,     , 0x7c, 0xc6, 0xfe, 0xc0, 0xc0, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0x66,     ,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    , 0x18, 0x3c, 0x66,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    , 0x60, 0x30, 0x18,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    , 0xc6,     , 0x10, 0x38, 0x6c, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [0x38, 0x6c, 0x38, 0x10, 0x38, 0x6c, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [0x0c, 0x18,     , 0xfe, 0x66, 0x62, 0x68, 0x78, 0x68, 0x62, 0x66, 0xfe,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xec, 0x36, 0x36, 0x7e, 0xd8, 0xd8, 0x6e,     ,     ,     ,     ],
        [    ,     , 0x3e, 0x6c, 0xcc, 0xcc, 0xfe, 0xcc, 0xcc, 0xcc, 0xcc, 0xce,     ,     ,     ,     ],
        [    , 0x10, 0x38, 0x6c,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     , 0xc6,     ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x60, 0x30, 0x18,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x30, 0x78, 0xcc,     , 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x60, 0x30, 0x18,     , 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     , 0xc6,     ,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7e, 0x06, 0x0c, 0x78,     ],
        [    , 0xc6,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0xc6,     , 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x18, 0x18, 0x7c, 0xc6, 0xc0, 0xc0, 0xc0, 0xc6, 0x7c, 0x18, 0x18,     ,     ,     ,     ],
        [    , 0x38, 0x6c, 0x64, 0x60, 0xf0, 0x60, 0x60, 0x60, 0x60, 0xe6, 0xfc,     ,     ,     ,     ],
        [    ,     , 0x66, 0x66, 0x3c, 0x18, 0x7e, 0x18, 0x7e, 0x18, 0x18, 0x18,     ,     ,     ,     ],
        [    , 0xf8, 0xcc, 0xcc, 0xf8, 0xc4, 0xcc, 0xde, 0xcc, 0xcc, 0xcc, 0xc6,     ,     ,     ,     ],
        [    , 0x0e, 0x1b, 0x18, 0x18, 0x18, 0x7e, 0x18, 0x18, 0x18, 0xd8, 0x70,     ,     ,     ,     ],
        [    , 0x18, 0x30, 0x60,     , 0x78, 0x0c, 0x7c, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    , 0x0c, 0x18, 0x30,     , 0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c,     ,     ,     ,     ],
        [    , 0x18, 0x30, 0x60,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    , 0x18, 0x30, 0x60,     , 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0x76,     ,     ,     ,     ],
        [    ,     , 0x76, 0xdc,     , 0xdc, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,     ,     ,     ,     ],
        [0x76, 0xdc,     , 0xc6, 0xe6, 0xf6, 0xfe, 0xde, 0xce, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     , 0x3c, 0x6c, 0x6c, 0x3e,     , 0x7e,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     , 0x38, 0x6c, 0x6c, 0x38,     , 0x7c,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     , 0x30, 0x30,     , 0x30, 0x30, 0x60, 0xc0, 0xc6, 0xc6, 0x7c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     , 0xfe, 0xc0, 0xc0, 0xc0, 0xc0,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     , 0xfe, 0x06, 0x06, 0x06, 0x06,     ,     ,     ,     ,     ],
        [    , 0x60, 0xe0, 0x62, 0x66, 0x6c, 0x18, 0x30, 0x60, 0xdc, 0x86, 0x0c, 0x18, 0x3e,     ,     ],
        [    , 0x60, 0xe0, 0x62, 0x66, 0x6c, 0x18, 0x30, 0x66, 0xce, 0x9a, 0x3f, 0x06, 0x06,     ,     ],
        [    ,     , 0x18, 0x18,     , 0x18, 0x18, 0x18, 0x3c, 0x3c, 0x3c, 0x18,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x36, 0x6c, 0xd8, 0x6c, 0x36,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xd8, 0x6c, 0x36, 0x6c, 0xd8,     ,     ,     ,     ,     ,     ],
        [0x11, 0x44, 0x11, 0x44, 0x11, 0x44, 0x11, 0x44, 0x11, 0x44, 0x11, 0x44, 0x11, 0x44, 0x11, 0x44],
        [0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa],
        [0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77, 0xdd, 0x77],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0xf8, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0xf8, 0x18, 0xf8, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0xf6, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [    ,     ,     ,     ,     ,     ,     , 0xfe, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [    ,     ,     ,     ,     , 0xf8, 0x18, 0xf8, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0xf6, 0x06, 0xf6, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [    ,     ,     ,     ,     , 0xfe, 0x06, 0xf6, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0xf6, 0x06, 0xfe,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0xfe,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0xf8, 0x18, 0xf8,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0xf8, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x1f,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0xff, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x1f, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [    ,     ,     ,     ,     ,     ,     , 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0xff, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x1f, 0x18, 0x1f, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x37, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x37, 0x30, 0x3f,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x3f, 0x30, 0x37, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0xf7,     , 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xff,     , 0xf7, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x37, 0x30, 0x37, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [    ,     ,     ,     ,     , 0xff,     , 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0xf7,     , 0xf7, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0xff,     , 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0xff,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xff,     , 0xff, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [    ,     ,     ,     ,     ,     ,     , 0xff, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x3f,     ,     ,     ,     ,     ,     ,     ,     ],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x1f, 0x18, 0x1f,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x1f, 0x18, 0x1f, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [    ,     ,     ,     ,     ,     ,     , 0x3f, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0xff, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36, 0x36],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0xff, 0x18, 0xff, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0xf8,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0x1f, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        [    ,     ,     ,     ,     ,     ,     , 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        [0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0, 0xf0],
        [0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f],
        [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x76, 0xdc, 0xd8, 0xd8, 0xd8, 0xdc, 0x76,     ,     ,     ,     ],
        [    ,     , 0x78, 0xcc, 0xcc, 0xcc, 0xd8, 0xcc, 0xc6, 0xc6, 0xc6, 0xcc,     ,     ,     ,     ],
        [    ,     , 0xfe, 0xc6, 0xc6, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0xfe, 0x6c, 0x6c, 0x6c, 0x6c, 0x6c, 0x6c,     ,     ,     ,     ],
        [    ,     , 0xfe, 0xc6, 0x60, 0x30, 0x18, 0x18, 0x30, 0x60, 0xc6, 0xfe,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7e, 0xd8, 0xd8, 0xd8, 0xd8, 0xd8, 0x70,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x7c, 0x60, 0x60, 0xc0,     ],
        [    ,     ,     ,     , 0x76, 0xdc, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18,     ,     ,     ,     ],
        [    ,     , 0x7e, 0x18, 0x3c, 0x66, 0x66, 0x66, 0x66, 0x3c, 0x18, 0x7e,     ,     ,     ,     ],
        [    ,     , 0x38, 0x6c, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0x6c, 0x38,     ,     ,     ,     ],
        [    ,     , 0x38, 0x6c, 0xc6, 0xc6, 0xc6, 0x6c, 0x6c, 0x6c, 0x6c, 0xee,     ,     ,     ,     ],
        [    ,     , 0x1e, 0x30, 0x18, 0x0c, 0x3e, 0x66, 0x66, 0x66, 0x66, 0x3c,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x7e, 0xdb, 0xdb, 0xdb, 0x7e,     ,     ,     ,     ,     ,     ],
        [    ,     ,     , 0x03, 0x06, 0x7e, 0xdb, 0xdb, 0xf3, 0x7e, 0x60, 0xc0,     ,     ,     ,     ],
        [    ,     , 0x1c, 0x30, 0x60, 0x60, 0x7c, 0x60, 0x60, 0x60, 0x30, 0x1c,     ,     ,     ,     ],
        [    ,     ,     , 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6,     ,     ,     ,     ],
        [    ,     ,     ,     , 0xfe,     ,     , 0xfe,     ,     , 0xfe,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x18, 0x18, 0x7e, 0x18, 0x18,     ,     , 0x7e,     ,     ,     ,     ],
        [    ,     ,     , 0x30, 0x18, 0x0c, 0x06, 0x0c, 0x18, 0x30,     , 0x7e,     ,     ,     ,     ],
        [    ,     ,     , 0x0c, 0x18, 0x30, 0x60, 0x30, 0x18, 0x0c,     , 0x7e,     ,     ,     ,     ],
        [    ,     , 0x0e, 0x1b, 0x1b, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
        [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0xd8, 0xd8, 0xd8, 0x70,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x18,     , 0x7e,     , 0x18,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     , 0x76, 0xdc,     , 0x76, 0xdc,     ,     ,     ,     ,     ,     ],
        [    , 0x38, 0x6c, 0x6c, 0x38,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0x18, 0x18,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     , 0x18,     ,     ,     ,     ,     ,     ,     ,     ],
        [    , 0x0f, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0xec, 0x6c, 0x6c, 0x3c, 0x1c,     ,     ,     ,     ],
        [    , 0x6c, 0x36, 0x36, 0x36, 0x36, 0x36,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    , 0x3c, 0x66, 0x0c, 0x18, 0x32, 0x7e,     ,     ,     ,     ,     ,     ,     ,     ,     ],
        [    ,     ,     ,     , 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,     ,     ,     ,     ,     ],
        [    ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ,     ]
    ];

    exports.Escapes = new Cursor();

}(this));
