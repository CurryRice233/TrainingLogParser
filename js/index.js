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

        let end = logParser.files[fileName].rangeEnd
        if (document.getElementById('removeZeros').checked) {
            end = logParser.files[fileName].rangeEndNoZeros;
        }

        document.getElementById('lossRangeText').value = logParser.files[fileName].rangeStart + ':' + end;

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
    logParser.updateLogSetting(
        document.getElementById('dialogTitle').innerText,
        document.getElementById('lossTagText').value,
        document.getElementById('lossRangeText').value,
        null,
        document.getElementById('regex').checked
    );
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
    let start = logParser.files[fileName].rangeStart
    let end = logParser.files[fileName].rangeEnd;
    if (document.getElementById('removeZeros').checked) {
        end = logParser.files[fileName].rangeEndNoZeros;
    }
    document.getElementById('lossSummary').innerText = 'Count: ' + (end - start) +
        ', Min: ' + logParser.files[fileName].min + ', Max: ' + logParser.files[fileName].max +
        ', Average: ' + logParser.files[fileName].average;
}

function resetLossSummary() {
    document.getElementById('lossSummary').innerText = 'Step: 0, Min: 0, Max: 0, Averages: 0';
}

function getMaxMinMean(array){
    let min = null;
    let max = null;
    let sum = 0;
    for (let i = 0; i < array.length; i++) {
        if (min == null || min > array[i]) {min = array[i];}
        if (max == null || max < array[i]) {max = array[i];}
        sum += array[i];
    }
    return [min, max, sum/array.length]
}


class LogParser {
    constructor() {
        this.files = {};
        this.defaultLossTag = 'loss:';
        this.chartTitle = 'Loss Chart';
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
                chartData: [],
                lossTag: '',
                durationTag: '',
                visible: false,
                min: 0,
                max: 0,
                average: 0,
                minNoZeros: 0,
                maxNoZeros: 0,
                averageNoZeros: 0,
                rangeStart: 0,
                rangeEnd: -1,
                rangeEndNoZeros: -1
            }

            let div = document.createElement('div');
            div.innerHTML = `
            <div class="checkboxDiv" id="selectLog_` + fileName + `">
                <input type="checkbox" id="` + fileName + `" name="` + fileName + `" value="` + fileName + `" onclick='checkboxClickHandler(this);' checked>
                <div class="marquee"><label class="checkboxText" for="` + fileName + `">` + fileName + `</label></div>
                <img src="img/setting.png" width="20px" height="20px" style="margin-left: 10px"  alt="setting" onclick='settingClickHandler("` + fileName + `");'/>
                <img src="img/delete.png" width="20px" height="20px" style="margin-left: 10px"  alt="setting" onclick='removeLogClickHandler("` + fileName + `");'/>
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

        this.updateLogSetting(fileName, this.files[fileName].lossTag, this.defaultDurationTag, false);
        if (this.files[fileName].length === 0) {
            settingClickHandler(fileName);
        } else {
            this.plotComparison();
        }
    }

    removeFile(fileName) {
        if(fileName in this.files) {
            document.getElementById("selectLog_" + fileName).remove();
            delete this.files[fileName]
            this.updateChart();
        }
    }

    setGlobalLossTag(lossTag){
        let chartTitle = lossTag.trim().replace(/[^a-zA-Z0-9()\s]/g, ' ');
        this.chartTitle = chartTitle.charAt(0).toUpperCase() + chartTitle.slice(1) + ' Chart';
        for (let key in this.files) {
            let rangeTag = this.files[key].rangeStart + ':' + this.files[key].rangeEnd;
            this.updateLogSetting(key, lossTag, rangeTag, this.files[key].durationTag, false);
        }
    }

    checkAndSetGlobalLossTag(){
        let lossTag = null;
        for (let key in this.files) {
            if(lossTag == null || this.files[key].lossTag === lossTag){
                lossTag = this.files[key].lossTag
            }else{
                return
            }
        }
        if(lossTag != null){
            let chartTitle = lossTag.replace(/[^a-zA-Z0-9()\s]/g, ' ').trim();
            this.chartTitle = chartTitle.charAt(0).toUpperCase() + chartTitle.slice(1) + ' Chart';
        }
    }

    updateLogSetting(fileName, lossTag, rangeTag, durationTag, regex) {
        this.defaultLossTag = lossTag;
        let range = rangeTag.split(":")
        this.files[fileName].rangeStart = parseInt(range[0]);
        this.files[fileName].rangeEnd = parseInt(range[1]);
        this.files[fileName].rangeEndNoZeros = parseInt(range[1]);

        let losses = this.parserLog(fileName, lossTag, durationTag, regex);

        if(isNaN(this.files[fileName].rangeStart)){
            this.files[fileName].rangeStart = 0;
        }
        if(isNaN(this.files[fileName].rangeEnd) || this.files[fileName].rangeEnd < 0){
            this.files[fileName].rangeEnd = losses[0].length;
            this.files[fileName].rangeEndNoZeros = losses[1].length;
        }

        this.files[fileName].losses = losses[0];
        this.files[fileName].lossesNoZeros = losses[1];
        this.updateLogData(fileName);
        this.updateChart();
    }

    parserLog(fileName, lossTag, durationTag, regex) {
        let file = this.files[fileName].file.split(/\n|\r\n/);
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

    updateLogData(fileName) {
        let start = this.files[fileName].rangeStart
        let end = this.files[fileName].rangeEnd
        let res = getMaxMinMean(this.files[fileName].losses.slice(start, end))
        this.files[fileName].min = res[0];
        this.files[fileName].max = res[1];
        this.files[fileName].average = res[2];
        end = this.files[fileName].rangeEndNoZeros
        res = getMaxMinMean(this.files[fileName].lossesNoZeros.slice(start, end))
        this.files[fileName].minNoZeros = res[0];
        this.files[fileName].maxNoZeros = res[1];
        this.files[fileName].averageNoZeros = res[2];
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
        this.updateChart()
    }

    updateChart(){
        this.checkAndSetGlobalLossTag();
        // update comparison step
        let step = parseInt(document.getElementById("stepText").value);
        if (isNaN(step) || step <= 0) {
            step = 1;
            document.getElementById("stepText").value = 1;
        }
        this.comparisonStep = step;

        // update range
        this.updateLossesRange();
        this.updateChartData();

        // plot charts
        this.plotLosses();
        this.plotComparison();
    }

    updateLossesRange(){
        this.lossRangeStart = null;
        this.lossRangeEnd = null;
        for (let file in this.files) {
            let end = this.files[file].rangeEnd;
            if (document.getElementById('removeZeros').checked) {
                end = this.files[file].rangeEndNoZeros;
            }

            if (this.files[file].visible && (this.lossRangeEnd == null || this.lossRangeEnd > end)) {
                this.lossRangeEnd = end;
            }

            if (this.files[file].visible && (this.lossRangeStart == null || this.lossRangeStart < this.files[file].rangeStart)) {
                this.lossRangeStart = this.files[file].rangeStart;
            }
        }
    }

    updateChartData(){
        for (let fileName in this.files) {
            if (this.files[fileName].visible) {
                let loss = this.files[fileName].losses;
                if (document.getElementById('removeZeros').checked) {
                    loss = this.files[fileName].lossesNoZeros;
                }
                this.files[fileName].chartData = loss.slice(this.lossRangeStart, this.lossRangeEnd);
            }
        }
    }

    plotLosses() {
        let data = [];

        for (let fileName in this.files) {
            if (this.files[fileName].visible) {
                let dataPoints = [];
                for (let i = 0; i < this.files[fileName].chartData.length; i = i + this.comparisonStep) {
                    let subArray = this.files[fileName].chartData.slice(i, i + this.comparisonStep);
                    dataPoints.push({x: i + this.lossRangeStart, y: subArray.reduce((a, b) => a + b, 0) / subArray.length});
                }

                data.push({
                    name: fileName,
                    type: 'line',
                    showInLegend: true,
                    dataPoints: dataPoints
                });
            }
        }

        let options = {
            zoomEnabled: true,
            animationEnabled: true,
            title: {
                text: this.chartTitle
            },
            axisY: {
                lineThickness: 1
            },
            data: data
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

    plotComparison() {
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
        let loss1 = this.files[fileName1].chartData;
        let loss2 = this.files[fileName2].chartData;


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

            this.comparison.normal.push({x: x * this.comparisonStep + this.lossRangeStart, y: tmp1 - tmp2});
            this.comparison.absolute.push({x: x * this.comparisonStep + this.lossRangeStart, y: Math.abs(tmp1 - tmp2)});
            this.comparison.relative.push({x: x * this.comparisonStep + this.lossRangeStart, y: Math.abs(tmp1 - tmp2) / tmp1});
            this.comparison.relative_baseline.push({x: x * this.comparisonStep + this.lossRangeStart, y: this.relative_error})

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
                text: "Comparison " + comparisonType + " Chart"
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

        let me;
        let mse;

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

