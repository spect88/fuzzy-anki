var ankiSeparator = '\x1f';

// deckNotes contains the contents of any APKG decks uploaded. It is an array of
// objects with the following properties:
// - "name", a string
// - "fieldNames", an array of strings
// - "notes", an array of objects, each with properties corresponding to the
// entries of fieldNames.
var deckNotes;

// Huge props to http://stackoverflow.com/a/9507713/500207
function tabulate(datatable, columns, containerString) {
    var table = d3.select(containerString).append("table"),
        thead = table.append("thead"), tbody = table.append("tbody");

    // append the header row
    thead.append("tr")
        .selectAll("th")
        .data(columns)
        .enter()
        .append("th")
        .text(function(column) { return column; })
        .attr("class", function(d) { return 'field-' + d.replace(" ", "-"); });

    // create a row for each object in the data
    var rows = tbody.selectAll("tr").data(datatable).enter().append("tr");

    // create a cell in each row for each column
    var cells = rows.selectAll("td")
                    .data(
                         function(row) {
                             return columns.map(function(column) {
                                 return {column : column, value : row[column]};
                             });
                         })
                    .enter()
                    .append("td")
                    .html(function(d) { return d.value; })
                    .attr("class", function(d) {
                        return 'field-' + d.column.replace(" ", "-");
                    });

    return table;
}

function sqlToDeckNotes(uInt8ArraySQLdb) {
    var db = new SQL.Database(uInt8ArraySQLdb);

    // Decks table (for deck names)
    decks = db.exec("SELECT decks FROM col");
    // Could use parseJSON from jQuery here.
    decks = Function('return ' + decks[0].values[0][0])();

    // Models table (for field names)
    col = db.exec("SELECT models FROM col");
    // Could use parseJSON from jQuery here.
    var models = Function('return ' + col[0].values[0][0])();

    // Notes table, for raw facts that make up individual cards
    deckNotes = db.exec("SELECT mid,flds FROM notes");

    _.each(_.keys(models), function(key) {
        models[key].fields = _.pluck(models[key].flds, 'name');
    });

    var notesByModel =
        _.groupBy(deckNotes[0].values, function(row) { return row[0]; });

    deckNotes = _.map(notesByModel, function(notesArray, modelId) {
        var modelName = models[modelId].name;
        var fieldNames = models[modelId].fields;
        var notesArray = _.map(notesArray, function(note) {
            var fields = note[1].split(ankiSeparator);
            return arrayNamesToObj(fieldNames, fields);
        });
        return {name : modelName, notes : notesArray, fieldNames : fieldNames};
    });

    return deckNotes;
}

function parseImages(imageTable,unzip,filenames){
    var map = {};
    for (var prop in imageTable) {
      if (filenames.indexOf(prop) >= 0) {
        var file = unzip.decompress(prop);
        map[imageTable[prop]] = converterEngine (file);
      }
    }
    d3.selectAll("img")
      .attr("src", function(d,i) {
        //Some filenames may be encoded. Decode them beforehand.
        var key = decodeURI(this.src.split('/').pop());
        if (key in map){
          return "data:image/png;base64,"+map[key];
        }
          return this.src;
      });
}

function converterEngine (input) { // fn BLOB => Binary => Base64 ?
  // adopted from https://github.com/NYTimes/svg-crowbar/issues/16
    var uInt8Array = new Uint8Array(input),
        i = uInt8Array.length;
    var biStr = []; //new Array(i);
    while (i--) {
        biStr[i] = String.fromCharCode(uInt8Array[i]);
    }
    var base64 = window.btoa(biStr.join(''));
    return base64;
}

function ankiBinaryToDeckNotes(ankiArray, options) {
    var compressed = new Uint8Array(ankiArray);
    var unzip = new Zlib.Unzip(compressed);
    var filenames = unzip.getFilenames();
    if (filenames.indexOf("collection.anki2") >= 0) {
        var plain = unzip.decompress("collection.anki2");
        var deckNotes = sqlToDeckNotes(plain);
        if (options && options.loadImage){
            if (filenames.indexOf("media") >= 0) {
                var plainmedia = unzip.decompress("media");
                var bb = new Blob([new Uint8Array(plainmedia)]);
                var f = new FileReader();
                f.onload = function(e) {
                    parseImages(JSON.parse(e.target.result),unzip,filenames);
                };
                f.readAsText(bb);
            }
        }
        return deckNotes;
    }
}

function drawTable(deckNotes) {
    $('#anki').html('');
    _.each(deckNotes, function(model, idx) {
        if (deckNotes.length > 1) {
            d3.select("#anki").append("h2").text(model.name);
        }
        var deckId = "deck-" + idx;
        d3.select("#anki").append("div").attr("id", deckId);
        tabulate(model.notes, model.fieldNames, "#" + deckId);
    });
}

function filterNotes(notes, query) {
    if (!query) return notes;

    var matching = _.filter(notes, function(note) {
        return _.some(note, function(value) {
            return String(value).indexOf(query) !== -1
        });
    });

    var regexp = new RegExp(escapeRegExp(query), 'g');
    var highlightedQuery =
      $('<span/>').addClass('search-highlighted').text(query)[0].outerHTML;

    return _.map(matching, function(note) {
        return _.mapObject(note, function(value) {
            var replaced = String(value).replace(regexp, highlightedQuery);
            return replaced;
        });
    });
}

function filterDecks(deckNotes, query) {
    return _.map(deckNotes, function(model, idx) {
        return {
            name: model.name,
            fieldNames: model.fieldNames,
            notes: filterNotes(model.notes, query)
        };
    });
}

function filterAndDrawDecks(deckNotes, query) {
    drawTable(filterDecks(deckNotes, query));
}

// Source: http://stackoverflow.com/a/6969486
function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function arrayNamesToObj(fields, values) {
    var obj = {};
    for (i in values) {
        obj[fields[i]] = values[i];
    }
    return obj;
}

$(document).ready(function() {
    var deckNotes;
    var onFileChange = function(event) {
        event.stopPropagation();
        event.preventDefault();
        var f = event.target.files[0];
        if (!f) {
            f = event.dataTransfer.files[0];
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            deckNotes =
                ankiBinaryToDeckNotes(e.target.result, { loadImage: false });

            $('.apkg-upload').hide();
            $('.searchbox').show();
            $('.zoombox').show();

            filterAndDrawDecks(deckNotes, '');
        };
        reader.readAsArrayBuffer(f);
    };

    var onSearchQueryChange = function(event) {
        filterAndDrawDecks(deckNotes, $('.searchbox input').val());
    };

    var onZoomClick = function(event) {
        var button = event.currentTarget;
        var className = _.find(button.classList, function(cls) {
            return cls.indexOf('font-') === 0;
        });

        $('#anki')
            .removeClass('font-small')
            .removeClass('font-normal')
            .removeClass('font-large')
            .removeClass('font-very-large')
            .removeClass('font-super-large')
            .addClass(className);

        $('.zoombox button').removeClass('active');
        $(button).addClass('active');
    };

    // Deck browser
    $('.apkg-upload input').change(onFileChange);

    $('.searchbox input').keydown(_.debounce(onSearchQueryChange, 500));

    $('.zoombox button').click(onZoomClick);
});
