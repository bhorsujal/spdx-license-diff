// SPDX-FileCopyrightText: Alan D. Tse <alandtse@gmail.com>
// SPDX-License-Identifier: (GPL-3.0-or-later AND Apache-2.0)

import { selectRangeCoords, getSelectionText } from "./cc-by-sa.js";
import { filters, defaultoptions } from "./const.js";
import $ from "jquery";
import _ from "underscore";

var version = chrome.runtime.getManifest().version;
var selectedLicense = "";
var spdx = null;
var rawspdx = null;
var selection = "";
var lastselection = "";
var processTime = 0;
var diffsdone = 0;
var diffsdue = 0;
var diffdisplayed = false;
var diffs = {};
var options;
var msStart;
var selectedfilters;

// init functions
restoreOptions();
createBubble();

// Event driven functions

// This function responds to the UI and background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  switch (request.command) {
    case "clicked_browser_action":
      sendResponse({ status: "1" }); // send receipt confirmation
      selection = getSelectionText();
      if (selection.length > 0) {
        createBubble();
        var selectCoords = selectRangeCoords();
        var posX = selectCoords[0];
        var posY = selectCoords[1];
        renderBubble(posX, posY, selection);
        if (spdx && selection === lastselection) {
          // diff previously done on selection
          updateProgressBar(1, 1, false);
          updateBubbleText("Done");
          processLicenses(
            options.showBest === 0 && spdx ? spdx.length : options.showBest,
            processTime
          );
          return;
        } else {
          rawspdx = null;
          spdx = null;
          diffdisplayed = false;
          selectedLicense = "";
          diffsdue = 0;
          diffsdone = 0;
          diffs = {};
        }
        msStart = new Date().getTime();
        compareSelection(selection);
        lastselection = selection;
      } else {
        updateBubbleText("No selection to compare; please select");
      }
      break;
    case "progressbarmax":
      updateProgressBar(request.value, null);
      updateBubbleText(request.stage);
      break;
    case "progressbarvalue":
      updateProgressBar(-1, request.value);
      break;
    case "next":
      updateProgressBar(-1, -1);
      break;
    case "sortdone":
      rawspdx = request.result;
      var msEnd = new Date().getTime();
      processTime = msEnd - msStart;
      console.log("processTime: " + processTime / 1000 + "s");
      updateBubbleText("Sorting done");
      processLicenses(
        options.showBest === 0 && rawspdx ? rawspdx.length : options.showBest,
        processTime
      );
      break;
    case "diffnext":
      updateProgressBar(-1, -1);
      var threadid = request.id;
      var result = request.result;
      var spdxid = request.spdxid;
      diffs[spdxid] = result;
      diffsdone++;
      if ($("#licenses option[value='" + spdxid + "']")) {
        $("#licenses option[value='" + spdxid + "']").removeAttr("disabled");
      }
      console.log(
        "%s: Received diff for %s %s/%s",
        threadid,
        spdxid,
        diffsdone,
        diffsdue
      );
      var bestspdxid = spdx[0].spdxid;
      if (diffsdone >= diffsdue) {
        console.log("All diffs complete; showing %s", bestspdxid);
        if (!diffdisplayed)
          displayDiff(diffs[bestspdxid].html, diffs[bestspdxid].time);
        updateBubbleText("Diffing done");
        document.getElementById("newTabButton").style.visibility = "visible";
      } else if (bestspdxid === spdxid) {
        console.log("Best diff %s received; we can display", bestspdxid);
        if (!diffdisplayed)
          displayDiff(diffs[bestspdxid].html, diffs[bestspdxid].time);
        updateBubbleText("Displaying diff");
      }
      break;
    case "newTab":
      diffs = request.diffs;
      spdx = request.spdx;
      selectedLicense =
        typeof selectedLicense !== "undefined"
          ? request.selectedLicense
          : spdx[0].spdxid;
      console.log("Received newTab request", request);
      updateProgressBar(1, 1, false);
      addSelectFormFromArray(
        "licenses",
        spdx,
        options.showBest === 0 && spdx ? spdx.length : options.showBest,
        options.minpercentage
      );
      displayDiff(diffs[selectedLicense].html, diffs[selectedLicense].time);
      break;
    case "alive?":
      console.log("Received ping request");
      sendResponse({ status: "1" });
      break;
    default:
      break;
  }
});

// This function responds to changes to storage
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && "options" in changes) {
    console.log("Detected changed options; reloading");
    restoreOptions();
  }
});

// processing phase functions (these are called by the workeronmessage in order)
// Compare selection against a fully populated license list (must be loaded in list)
// This is the first phase to determine edit distance and return a sorted list
// for display in spdx
function compareSelection(selection) {
  chrome.runtime.sendMessage({
    command: "compareselection",
    selection: selection,
  });
}

// This will begin displaying diffs based off sorted list spdx
function processLicenses(showBest, processTime = 0) {
  var license;
  spdx = filterSPDX(rawspdx);
  console.log(
    "Processing diffs for %s items exceeding %s% match",
    showBest,
    Number(options.minpercentage)
  );
  if (
    spdx &&
    (spdx.length === 0 ||
      Number(spdx[0].percentage) <= Number(options.minpercentage))
  ) {
    console.log("No results to display");
    displayDiff(null, processTime);
    updateProgressBar(spdx.length, spdx.length);
    addSelectFormFromArray("licenses", spdx, showBest, options.minpercentage);
  } else if (spdx && diffdisplayed) {
    updateProgressBar(1, 1, false);
    addSelectFormFromArray("licenses", spdx, showBest, options.minpercentage);
    license = spdx[0].spdxid;
    if (diffs[license] !== undefined) {
      displayDiff(diffs[license].html, diffs[license].time);
      document.getElementById("newTabButton").style.visibility = "visible";
    }
  } else {
    diffsdue = 0;
    for (var i = 0; i < showBest; i++) {
      license = spdx[i].spdxid;
      var data = spdx[i].difftext;
      var distance = spdx[i].distance;
      var percentage = spdx[i].percentage;
      if (i === 0) {
        selectedLicense = license;
        console.log(
          "Best match of " +
            showBest +
            " : " +
            license +
            ": " +
            distance +
            " (" +
            percentage +
            "%)"
        );
      } else if (Number(percentage) < Number(options.minpercentage)) {
        break;
      } else {
        console.log(license + ": " + distance + " (" + percentage + "%)");
      }
      if (diffs[license] === undefined) {
        diffsdue++;
        chrome.runtime.sendMessage({
          command: "generateDiff",
          selection: selection,
          spdxid: license,
          license: data,
          record: i,
        });
        console.log("Generating diff for " + license + " total " + diffsdue);
      } else {
        console.log("Diff found for " + license);
      }
    }
    if (diffsdue > diffsdone) {
      updateProgressBar(diffsdue, 0);
      updateBubbleText("Diffing");
    }
    addSelectFormFromArray("licenses", spdx, showBest, options.minpercentage);
    license = spdx[0].spdxid;
    if (diffs[license] !== undefined) {
      displayDiff(diffs[license].html, diffs[license].time);
      document.getElementById("newTabButton").style.visibility = "visible";
    }
  }
  if (diffsdue <= diffsdone) {
    updateProgressBar(1, 1, false);
    updateBubbleText("Done");
  }
}

// This will filter the spdx
function filterSPDX(rawspdx) {
  var spdx = [];
  var filtered = 0;
  if (selectedfilters === undefined) {
    selectedfilters = options.filters;
  }
  var showBest =
    options.showBest === 0 && rawspdx ? rawspdx.length : options.showBest;
  for (var i = 0; i < showBest + filtered; i++) {
    var license = rawspdx[i].spdxid;
    var details = rawspdx[i].details;
    var skiplicense = false;
    for (var filter of Object.keys(selectedfilters)) {
      if (details && details[selectedfilters[filter]]) {
        skiplicense = true;
        filtered++;
        console.log(
          "Filtering %s because its %s: %s total",
          license,
          filter,
          filtered
        );
        break;
      }
    }
    if (skiplicense) {
      continue;
    }
    spdx.push(rawspdx[i]);
  }
  return spdx;
}

// This is the actual diff display function, requires a populated spdx
function displayDiff(html, time = processTime) {
  diffdisplayed = true;
  if (!html) {
    updateBubbleText(
      "Time: " + time / 1000 + " s<br /><hr />No results to display",
      "#result_text"
    );
    return;
  }
  var spdxid = spdx[0].spdxid;
  var details = spdx[0].details;
  if (selectedLicense) {
    for (var index in spdx) {
      if (spdx[index].spdxid === selectedLicense) {
        spdxid = selectedLicense;
        details = spdx[index].details;
        break;
      }
    }
  }
  updateBubbleText(prepDiff(spdxid, time, html, details), "#result_text");
  var licenseElement = document.getElementById("licenses");
  licenseElement.addEventListener(
    "change",
    function () {
      if (this.value !== selectedLicense) {
        selectedLicense = this.value;
        spdxid = spdx[this.options.selectedIndex].spdxid;
        html = diffs[spdxid].html;
        time = diffs[spdxid].time;
        details = spdx[this.options.selectedIndex].details;
        updateBubbleText(prepDiff(spdxid, time, html, details), "#result_text");
      } else {
      }
    },
    false
  );
  licenseElement.value = selectedLicense;
  licenseElement.dispatchEvent(new Event("change"));
}

// This wraps the diff display
function prepDiff(spdxid, time, html, details) {
  var hoverInfo = "tags: ";
  for (var filter in filters) {
    if (details[filters[filter]]) {
      hoverInfo += filter + " ";
    }
  }
  if (details.licenseComments) {
    hoverInfo += "&#10;comments: " + _.escape(details.licenseComments);
  }
  var title = `<a href="https://spdx.org/licenses/${spdxid}.html" target="_blank" title="${hoverInfo}">${details.name} (${spdxid})</a>`;
  var timehtml =
    " processed in " + (time + processTime) / 1000 + "s<br /><hr />";
  return title + timehtml + html;
}

// This shows available filters as checkboxes
function showFilters(form) {
  if (document.getElementById("filters")) {
    return;
  }
  if (window.location.href.endsWith("/popup.html")) return;
  var div = form.appendChild(document.createElement("div"));
  div.id = "filters";
  var label = form.appendChild(document.createElement("label"));
  label.appendChild(document.createTextNode("Exclude: "));
  for (var filter in filters) {
    var checkbox = form.appendChild(document.createElement("input"));
    label = checkbox.appendChild(document.createElement("label"));
    label.htmlFor = filter;
    form.appendChild(
      document.createTextNode(filter.charAt(0).toUpperCase() + filter.slice(1))
    );
    checkbox.type = "checkbox";
    checkbox.id = filter;
    checkbox.value = filters[filter];
    checkbox.checked = options.filters[filter];
    checkbox.addEventListener(
      "change",
      function () {
        console.log("%s changed to %s", this, this.checked);
        if (this.checked) {
          selectedfilters[this.id] = this.value;
        } else {
          delete selectedfilters[this.id];
        }
        diffdisplayed = false;
        processLicenses(
          options.showBest === 0 && spdx ? spdx.length : options.showBest,
          processTime
        );
        // chrome.runtime.sendMessage({ 'command': 'resort', 'filter': selectedfilters })
        // msStart = (new Date()).getTime() + processTime
      },
      false
    );
  }
  form.appendChild(document.createElement("br"));
}

// This function will create a select form with the sorted licenses in arr
function addSelectFormFromArray(id, arr, number = arr.length, minimum = 0) {
  var form = document.getElementById(id);
  if (form) {
    form.outerHTML = "";
  }
  if (!$("#license_form").length) {
    var bubbleDOM = $("#license_bubble")[0];
    var bubbleDOMText = $("#result_text")[0];
    form = bubbleDOM.insertBefore(
      document.createElement("form"),
      bubbleDOMText
    );
    form.setAttribute("id", "license_form");
  }
  form = document.getElementById("license_form");
  showFilters(form);
  var select = form.appendChild(document.createElement("select"));
  select.id = id;
  for (var i = 0; i < arr.length && i < number; i++) {
    var value = arr[i].spdxid;
    var percentage = arr[i].percentage;
    var dice = arr[i].dice;
    var text =
      value +
      " : " +
      percentage +
      "% match (" +
      arr[i].distance +
      " differences / dice-coefficient " +
      dice +
      ")";
    if (percentage === 100) {
      text =
        value +
        " : " +
        percentage +
        "% template match (" +
        arr[i].distance +
        " differences / dice-coefficient " +
        dice +
        ")";
    }

    if (Number(percentage) < Number(minimum)) {
      // No match at all
      break;
    }
    var option = select.appendChild(document.createElement("option"));
    option.value = value;
    option.text = text;
    if (diffs[value] === undefined) {
      option.setAttribute("disabled", "disabled");
    }
  }
  createNewLicenseButton(form);
  createNewTabButton(form, selectedLicense);
}

// Display helper functions for modifying the DOM

// Add bubble to the top of the page.
function createBubble() {
  if ($("#license_bubble").length) return;
  var bubbleDOM = document.createElement("div");
  bubbleDOM.setAttribute("class", "selection_bubble");
  bubbleDOM.setAttribute("id", "license_bubble");
  document.body.appendChild(bubbleDOM);
  var progressbar = document.createElement("progress");
  progressbar.setAttribute("id", "progress_bubble");
  progressbar.setAttribute("max", 100);
  progressbar.value = 0;
  bubbleDOM.appendChild(progressbar);
  var bubbleDOMText = document.createElement("div");
  bubbleDOMText.setAttribute("id", "bubble_text");
  bubbleDOM.appendChild(bubbleDOMText);
  var resultText = document.createElement("div");
  resultText.setAttribute("id", "result_text");
  bubbleDOM.appendChild(resultText);
}
// Close the bubble when we click on the screen.
document.addEventListener(
  "mousedown",
  function (e) {
    if (
      e.target.id === "license_bubble" ||
      $(e.target).parents("#license_bubble").length ||
      $(window).outerWidth() <= e.clientX ||
      document.documentElement.offsetWidth <= e.clientX
    ) {
    } else {
      var bubbleDOM = $("#license_bubble")[0];
      bubbleDOM.remove();
      createBubble();
      // var posX = e.clientX
      // var posY = e.clientY
    }
  },
  false
);

// Add new license button.
function createNewLicenseButton(form) {
  if ($("#newLicenseButton").length) return;
  if (window.location.href.endsWith("/popup.html")) return;
  var button = document.createElement("button");
  button.innerHTML = "Submit new license";
  button.type = "button";
  button.id = "newLicenseButton";
  form.appendChild(button);
  form.appendChild(document.createElement("br"));
  button.addEventListener("click", function () {
    chrome.runtime.sendMessage({
      command: "submitNewLicense",
      selection: selection,
      url: location.href,
    });
  });
}

// Add new tab button.
function createNewTabButton(form, selectedLicense) {
  if (window.location.href.endsWith("/popup.html")) return;
  if ($("#newTabButton").length) {
    // Button already exists, just update its visibility if needed
    return;
  }
  var button = document.createElement("button");
  button.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M4.5 11H3v4h4v-1.5H4.5V11zM3 7h1.5V4.5H7V3H3v4zm10.5 6.5H11V15h4v-4h-1.5v2.5zM11 3v1.5h2.5V7H15V3h-4z"/></svg>';
  button.type = "button";
  button.id = "newTabButton";
  button.style.visibility = "hidden";
  form.appendChild(button);
  form.appendChild(document.createElement("br"));
  button.addEventListener("click", newTab);
}

function newTab() {
  var license = selectedLicense;
  chrome.runtime.sendMessage({
    command: "newTab",
    diffs: diffs,
    selectedLicense: license,
    spdx: spdx,
  });
}

// Move that bubble to the appropriate location.
function renderBubble(mouseX, mouseY, selection) {
  updateProgressBar(-1, 1, true);
  // var progressbar = $('#progress_bubble')[0]
  updateBubbleText("Processing...");
  var bubbleDOM = $("#license_bubble")[0];
  bubbleDOM.style.top = mouseY + "px";
  bubbleDOM.style.left = mouseX + "px";
  bubbleDOM.style.visibility = "visible";
  $("html,body").animate(
    {
      scrollTop: $("#progress_bubble").offset().top,
    },
    "fast"
  );
}

function updateBubbleText(text, target = "#bubble_text") {
  var bubbleDOMText = $(target)[0];
  // convert html to xhtml
  // concept from https://stackoverflow.com/a/12092919 and
  // https://devtidbits.com/2017/12/06/quick-fix-the-unsafe_var_assignment-warning-in-javascript/
  text = new XMLSerializer().serializeToString(
    new DOMParser().parseFromString(text, "text/html")
  );
  text = new DOMParser().parseFromString(text, "application/xml");
  const tags = text.getElementsByTagName(`body`);
  bubbleDOMText.innerHTML = ``;
  for (const tag of tags) {
    bubbleDOMText.appendChild(tag);
  }
}

// max will increase if > 0; value will be set if not null and >=0
// else incremented by absolute value for negative numbers
function updateProgressBar(max, value, visible = true) {
  var progressbar = $("#progress_bubble")[0];
  progressbar.style.visibility = visible ? "visible" : "hidden";
  if (max > 0) {
    progressbar.setAttribute("max", max);
  }
  if (value !== null) {
    if (value >= 0) {
      progressbar.value = value;
    } else if (progressbar.value < progressbar.getAttribute("max")) {
      progressbar.value = progressbar.value + Math.abs(value);
    }
  }
}

function restoreOptions() {
  chrome.storage.local.get(["options"], function (result) {
    options = result.options;
    if (options === undefined) {
      options = defaultoptions;
    }
  });
}

console.log("Spdx-license-diff " + version + " ContentScript injected");
