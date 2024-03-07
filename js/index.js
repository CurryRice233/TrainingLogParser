const lossRegExp = new RegExp('[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?');

function selectFile(evt) {
    if (evt.target.files.length > 0) {
        readFile(evt.target.files[0])
    }
}

function dropHandler(event) {
    event.preventDefault();
    if (event.dataTransfer.items) {
        [...event.dataTransfer.items].forEach((item, i) => {
            if (item.kind === 'file') {
                readFile(item.getAsFile());
            }
        });
    }
}

function dragoverHandler(event) {
    event.preventDefault();
}

function checkboxClickHandler(event) {
    logParser.updateLogVisible(event.name, event.checked)
}

function getMeanError(erros) {
    let me = 0.0;
    let mse = 0.0;
    for (let i = 0; i < erros.length; i++) {
        me += erros[i].y;
        mse += erros[i].y * erros[i].y;
    }
    return [me / erros.length, mse / erros.length]
}

function settingClickHandler(fileName) {
    let dialog = document.getElementById('dialogDiv');
    if (typeof dialog.showModal === "function") {
        document.getElementById('dialogTitle').innerText = fileName;
        document.getElementById('dialogContext').innerText = '\nFound loss step: ' + logParser.files[fileName].losses.length;
        document.getElementById('lossTagText').value = logParser.files[fileName].lossTag;

        // remove all event listener
        let old_element = document.getElementById("dialogDownloadCSV");
        let new_element = old_element.cloneNode(true);
        old_element.parentNode.replaceChild(new_element, old_element);
        document.getElementById('dialogDownloadCSV').addEventListener('click', function (e) {
            logParser.downloadCSV(fileName);
        })
        dialog.showModal();
    }
}

function removeLogClickHandler(fileName) {
    logParser.removeFile(fileName);
}

function dialogButtonHandler(event) {
    document.getElementById('dialogDiv').close();
    logParser.updateLossTag(
        document.getElementById('dialogTitle').innerText,
        document.getElementById('lossTagText').value,
        null,
        document.getElementById('regex').checked
    );
    logParser.updateComparison();
}

function comparisonRadioHandler(comparisonType) {
    logParser.updateComparisonChart(comparisonType)
}


function readFile(file) {
    let reader = new FileReader();
    reader.onload = (function (file) {
        return function (e) {
            logParser.addFile(file.name.trim(), e.target.result)
        }
    })(file);
    reader.readAsText(file);
}

function setLossSummary(fileName) {
    document.getElementById('lossSummary').innerText = 'Step: ' + logParser.files[fileName].losses.length +
        ', Min: ' + logParser.files[fileName].min + ', Max: ' + logParser.files[fileName].max +
        ', Average: ' + logParser.files[fileName].average;
}

function resetLossSummary() {
    document.getElementById('lossSummary').innerText = 'Step: 0, Min: 0, Max: 0, Averages: 0';
}


class LogParser {
    constructor() {
        this.files = {};
        this.defaultLossTag = 'loss:';
        this.defaultDurationTag = 'elapsed time per iteration (ms): ';
        this.comparison = {
            normal: [],
            absolute: [],
            relative: [],
            relative_baseline: [],
            normal_mean_square_error: 0,
            normal_mean_error: 0,
            absolute_mean_square_error: 0,
            absolute_mean_error: 0,
            relative_mean_square_error: 0,
            relative_mean_error: 0,
        }
        this.relative_error = 0.02
        this.comparisonType = 'normal';
        this.cookies = {};
        this.comparisonStep = 1;


        let cookies = document.cookie.split(';');
        for (let i in cookies) {
            let cookie = cookies[i].split('=', 2);
            if (cookie !== undefined && cookie.length > 1) {
                this.cookies[cookie[0].trim()] = cookie[1];
            }
        }
    }

    addFile(fileName, fileText) {
        if (!(fileName in this.files)) {
            this.files[fileName] = {
                file: '',
                losses: [],
                lossesNoZeros: [],
                dataPoints: [],
                lossTag: '',
                durationTag: '',
                visible: false,
                min: 0,
                max: 0,
                average: 0
            }

            let div = document.createElement('div');
            div.innerHTML = `
            <div class="checkboxDiv" id="selectLog_` + fileName + `">
                <input type="checkbox" id="` + fileName + `" name="` + fileName + `" value="` + fileName + `" onclick='checkboxClickHandler(this);' checked>
                <div class="marquee"><label class="checkboxText" for="` + fileName + `">` + fileName + `</label></div>
                <img src="img/setting.png" width="20px" height="20px" style="padding-left: 10px"  alt="setting" onclick='settingClickHandler("` + fileName + `");'/>
                <img src="img/delete.png" width="20px" height="20px" style="padding-left: 10px"  alt="setting" onclick='removeLogClickHandler("` + fileName + `");'/>
            </div>
            `
            document.getElementById("selectLogs").appendChild(div);
            div.addEventListener('mouseover', function (e) {
                setLossSummary(fileName);
            })
            div.addEventListener('mouseout', function (e) {
                resetLossSummary();
            })
            this.files[fileName].visible = true;
        }
        this.files[fileName].file = fileText;
        if (fileName in this.cookies) {
            this.files[fileName].lossTag = this.cookies[fileName];
        } else {
            this.files[fileName].lossTag = this.defaultLossTag;
            this.cookies[fileName] = this.defaultLossTag;
        }
        console.log('Added ' + fileName);

        this.updateLossTag(fileName, this.files[fileName].lossTag, this.defaultDurationTag, false);
        if (this.files[fileName].length === 0) {
            settingClickHandler(fileName);
        } else {
            this.updateComparison();
        }
    }

    removeFile(fileName) {
        if (fileName in this.files) {
            document.getElementById("selectLog_" + fileName).remove();
            delete this.files[fileName]
            this.updateStep();
        }
    }

    updateLossTag(fileName, lossTag, durationTag, regex) {
        this.defaultLossTag = lossTag;
        let losses = this.parserLog(fileName, lossTag, durationTag, regex);
        this.files[fileName].losses = losses[0];
        this.files[fileName].lossesNoZeros = losses[1];
        this.addLossData(fileName, losses[0]);
        this.plotLosses();
    }

    parserLog(fileName, lossTag, durationTag, regex) {
        let file = this.files[fileName].file.split('\n');
        this.files[fileName].lossTag = lossTag;
        this.cookies[fileName] = lossTag;
        this.saveLossTagToCookie();

        this.files[fileName].durationTag = durationTag;
        let losses = [];
        let lossesNoZeros = [];
        let regExObject = null;

        if (regex) {
            regExObject = new RegExp(lossTag);
        }

        for (let i = 0; i < file.length; i++) {
            let loss = null;
            if (regex) {
                loss = this.parserLossByRegex(file[i], regExObject);
            } else {
                loss = this.parserLossByLine(file[i], lossTag);
            }

            if (loss != null && !isNaN(loss)) {
                losses.push(loss);
                if (loss > 0) {
                    lossesNoZeros.push(loss);
                }
            }
        }
        return [losses, lossesNoZeros];
    }

    addLossData(fileName, losses) {
        let dataPoints = [];
        let min = null;
        let max = null;
        let sum = 0;
        for (let i = 0; i < losses.length; i++) {
            dataPoints.push({x: i, y: losses[i]});
            if (min == null || min > losses[i]) {
                min = losses[i];
            }
            if (max == null || max < losses[i]) {
                max = losses[i];
            }
            sum += losses[i];
        }
        this.files[fileName].lossData = dataPoints;
        this.files[fileName].min = min;
        this.files[fileName].max = max;
        this.files[fileName].average = sum / losses.length;
        this.updateLossStep(fileName);
    }

    parserLossByLine(line, lossText) {
        let pos = line.indexOf(lossText);
        let loss = null;
        if (pos !== -1) {
            let res = lossRegExp.exec(line.substring(pos + lossText.length).trim().split(/\s+/)[0]);
            if (res != null) {
                loss = parseFloat(res[0]);
            } else {
                console.log('Found loss text, but parse loss value with error: [' + line + ']');
            }
        }
        return loss;
    }

    parserLossByRegex(line, lossReg) {
        let loss = null;
        let res = lossReg.exec(line);
        if (res != null) {
            loss = parseFloat(res[0]);
        }
        return loss;
    }

    // parserLossByDuration(line, durationText){
    //     let pos = line.indexOf(durationText);
    //     let duration = null;
    //     if(pos !== -1){
    //         let res = lossRegExp.exec(line.substring(pos+lossText.length).split(/\s+/)[0]);
    //         if(res != null){
    //             duration = new Date('1970-01-01T'+res[0]);
    //             if(duration.toString() !== 'Invalid Date'){
    //                 return
    //             }
    //         }
    //     }
    //     return duration;
    // }

    updateLogVisible(fileName, visible) {
        this.files[fileName].visible = visible;
        this.plotLosses();
        this.updateComparison();
    }

    updateStep() {
        let step = parseInt(document.getElementById("stepText").value);
        if (isNaN(step) || step <= 0) {
            step = 1;
            document.getElementById("stepText").value = 1;
        }
        this.comparisonStep = step;
        this.updateAllLossStep();
        this.updateComparison();
        this.plotLosses();
    }

    updateAllLossStep() {
        for (let fileName in this.files) {
            this.updateLossStep(fileName);
        }
    }

    updateLossStep(fileName) {
        let dataPoints = [];
        let losses;
        if (document.getElementById('removeZeros').checked) {
            losses = this.files[fileName].lossesNoZeros;
        } else {
            losses = this.files[fileName].losses;
        }

        for (let i = 0; i < losses.length; i = i + this.comparisonStep) {
            let subArray = losses.slice(i, i + this.comparisonStep);
            dataPoints.push({x: i, y: subArray.reduce((a, b) => a + b, 0) / subArray.length});
        }
        this.files[fileName].chartData = dataPoints;
    }

    plotLosses() {
        let data = [];
        let maxLen = null;
        for (let fileName in this.files) {
            if (this.files[fileName].visible && (maxLen == null || maxLen > this.files[fileName].chartData.length)) {
                maxLen = this.files[fileName].chartData.length;
            }
        }
        for (let fileName in this.files) {
            if (this.files[fileName].visible) {
                data.push({
                    name: fileName,
                    type: 'line',
                    showInLegend: true,
                    dataPoints: this.files[fileName].chartData.slice(0, maxLen)
                });
            }
        }

        let options = {
            zoomEnabled: true,
            animationEnabled: true,
            title: {
                text: "Loss Chart"
            },
            axisY: {
                lineThickness: 1
            },
            data: data  // random data
        };

        document.getElementById("uploadDiv").style.display = 'none';
        document.getElementById("lossChart").style.display = 'block';

        if (data.length > 0) {
            document.getElementById("lossChart").style.display = 'block';
            this.lossChart = new CanvasJS.Chart(document.getElementById("lossChart"), options);
            this.lossChart.render();
        } else {
            document.getElementById("lossChart").style.display = 'none';
        }

    }

    updateComparison() {
        let filtered = [];
        for (let key in this.files) {
            if (this.files[key].visible) {
                filtered.push(key);
            }
        }
        if (filtered.length !== 2) {
            this.clearComparisonChart();
        } else {
            filtered.sort();
            this.updateComparisonData(filtered[0], filtered[1])
        }
    }

    updateComparisonData(fileName1, fileName2) {
        let loss1;
        let loss2;

        if (document.getElementById('removeZeros').checked) {
            loss1 = this.files[fileName1].lossesNoZeros;
            loss2 = this.files[fileName2].lossesNoZeros;
        } else {
            loss1 = this.files[fileName1].losses;
            loss2 = this.files[fileName2].losses;
        }


        this.comparison.normal = [];
        this.comparison.absolute = [];
        this.comparison.relative = [];
        this.comparison.relative_baseline = [];

        let totalLength = Math.min(loss1.length, loss2.length);

        let i = 0;
        let x = 0;
        while (i < totalLength) {
            let tmp1, tmp2;
            if (i + this.comparisonStep <= totalLength) {
                tmp1 = loss1.slice(i, i + this.comparisonStep).reduce((sum, n) => sum + n, 0) / this.comparisonStep;
                tmp2 = loss2.slice(i, i + this.comparisonStep).reduce((sum, n) => sum + n, 0) / this.comparisonStep;
            } else {
                tmp1 = loss1.slice(i, totalLength).reduce((sum, n) => sum + n, 0) / (totalLength - i);
                tmp2 = loss2.slice(i, totalLength).reduce((sum, n) => sum + n, 0) / (totalLength - i);
            }

            this.comparison.normal.push({x: x * this.comparisonStep, y: tmp1 - tmp2});
            this.comparison.absolute.push({x: x * this.comparisonStep, y: Math.abs(tmp1 - tmp2)});
            this.comparison.relative.push({x: x * this.comparisonStep, y: Math.abs(tmp1 - tmp2) / tmp1});
            this.comparison.relative_baseline.push({x: x * this.comparisonStep, y: this.relative_error})

            i += this.comparisonStep;
            x++;
        }

        let errors = getMeanError(this.comparison.normal)
        this.comparison.normal_mean_error = errors[0];
        this.comparison.normal_mean_square_error = errors[1];

        errors = getMeanError(this.comparison.absolute)
        this.comparison.absolute_mean_error = errors[0];
        this.comparison.absolute_mean_square_error = errors[1];

        errors = getMeanError(this.comparison.relative)
        this.comparison.relative_mean_error = errors[0];
        this.comparison.relative_mean_square_error = errors[1];

        this.updateComparisonChart(this.comparisonType);
    }

    updateComparisonChart(comparisonType) {
        let options = {
            zoomEnabled: true,
            animationEnabled: true,
            title: {
                text: "Comparison Chart"
            },
            axisY: {
                lineThickness: 1
            },
            data: [{
                name: 'Error',
                type: 'line',
                showInLegend: true,
                dataPoints: this.comparison[comparisonType]
            }]
        };

        if (comparisonType === 'relative') {
            options.data.push({
                name: 'Baseline',
                type: 'line',
                showInLegend: true,
                dataPoints: this.comparison.relative_baseline
            })
        }

        let me = 0.0;
        let mse = 0.0;

        if (comparisonType === 'normal') {
            me = this.comparison.normal_mean_error;
            mse = this.comparison.normal_mean_square_error;
        } else if (comparisonType === 'absolute') {
            me = this.comparison.absolute_mean_error;
            mse = this.comparison.absolute_mean_square_error;
        } else {
            me = this.comparison.relative_mean_error;
            mse = this.comparison.relative_mean_square_error;
        }

        console.log(this.comparison.normal_mean_error);

        document.getElementById("meanError").innerText = 'Mean Error: ' + me + ',  Mean Square Error: ' + mse;

        document.getElementById("comparisonChart").style.display = 'block';
        this.comparisonChart = new CanvasJS.Chart(document.getElementById("comparisonChart"), options);
        this.comparisonChart.render();
        logParser.comparisonType = comparisonType;
    }

    clearComparisonChart() {
        document.getElementById("comparisonChart").style.display = 'none';
        document.getElementById("meanError").innerText = '';
    }

    saveLossTagToCookie() {
        for (let cookie in this.cookies) {
            if (window.location.hostname === 'openx.huawei.com') {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/project/1738";
            } else {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/";
            }
        }
    }

    downloadCSV(fileName) {
        let csvContent = 'data:text/csv;charset=utf-8,' + this.files[fileName].losses.join('\n');
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", fileName + '.csv');
        link.click();
    }
}


logParser = new LogParser();


const clearAdvertisingInterval = setInterval(clearAdvertising, 1000);
var removeCount = 0;

function clearAdvertising() {
    if (document.getElementById("usp_yan") != null) {
        document.getElementById("usp_yan").style.display = 'none';
        if (removeCount === 5) {
            clearInterval(clearAdvertisingInterval);
        }
        removeCount += 1;
    }
}
