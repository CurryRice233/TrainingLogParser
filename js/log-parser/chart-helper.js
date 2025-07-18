function setDataMaxMinMean(fileName, fileData){
    let innerText = ''
    for(let key in fileData.keyDatas){
        let keyData = fileData.keyDatas[key]
        innerText = `${innerText}[${key}] ${keyData.getDataInfo(isNoZero())} \n`
    }
    document.getElementById('dataMaxMinMean').innerText = innerText
}

function clearDataMaxMinMean(){
    document.getElementById('dataMaxMinMean').innerText = '';
}

function addFileDiv(fileName, fileData){
    let div = document.createElement('div');
    div.innerHTML = `
        <div class="checkboxDiv" id="selectLog_` + fileName + `">
            <input type="checkbox" id="` + fileName + `" name="` + fileName + `" value="` + fileName + `" onclick='checkboxClickHandler(this);' checked>
            <div class="marquee"><label class="checkboxText" for="` + fileName + `">` + fileName + `</label></div>
            <img src="img/setting.png" width="20px" height="20px" style="margin-left: 10px"  alt="setting" onclick='settingClickHandler("` + fileName + `");'/>
            <img src="img/delete.png" width="20px" height="20px" style="margin-left: 10px"  alt="setting" onclick='removeLogClickHandler("` + fileName + `");'/>
        </div>
    `
    div.addEventListener('mouseover', function (e) {
        setDataMaxMinMean(fileName, fileData);
    })
    div.addEventListener('mouseout', function (e) {
        clearDataMaxMinMean();
    })
    document.getElementById("selectLogs").appendChild(div);
}

function getGlobalParseKey(){
    return document.getElementById("globalParseKeyText").value;
}

function getComparisonStep(){
    let comparisonStep = parseInt(document.getElementById("stepText").value);
    if(isNaN(comparisonStep) || comparisonStep <= 0) {
        comparisonStep = 1;
        document.getElementById("stepText").value = 1;
    }
    return comparisonStep;
}

function isNoZero(){
    return document.getElementById("removeZeros").checked;
}

function isDisableComparison(){
    return document.getElementById("disableComparison").checked;
}

function getKeyDataPoints(keyData, isNoZero, comparisonStep, length){
    let dataPoints = [];
    let dataArray;
    if(!isNoZero){
        dataArray = keyData.rangeData.slice(0, length);
    }else{
        dataArray = keyData.rangeDataNoZero.slice(0, length);
    }
    for(let i = 0; i < dataArray.length; i = i + comparisonStep){
        let subArray = dataArray.slice(i, i+comparisonStep);
        dataPoints.push({x:i, y:subArray.reduce((a, b) => a + b, 0) / subArray.length});
    }
    return dataPoints
}

function getRangeLength(files){
    let ranges = []
    for(let fileName in files){
        let file = files[fileName];
        if(file.visible){
            for(let index in file.parsedKeys){
                let key = file.parsedKeys[index]
                if(index < ranges.length){
                    ranges[index] = Math.min(ranges[index], file.keyDatas[key].rangeEnd - file.keyDatas[key].rangeStart);
                }else{
                    ranges.push(file.keyDatas[key].rangeEnd - file.keyDatas[key].rangeStart)
                }
            }
        }
    }
    return ranges
}

function prepareParseKeyChartData(files, isNoZero, comparisonStep){
    let parseKeyData = [];
    let parseKey = [];
    let rangesLength = getRangeLength(files);
    for(let fileName in files){
        let file = files[fileName];
        if(file.visible){
            for(let index in file.parsedKeys){
                let key = file.parsedKeys[index]
                let data = file.keyDatas[key]
                if (index >= parseKeyData.length){
                    parseKeyData.push([]);
                    parseKey.push([]);
                }
                parseKeyData[index].push({
                    name: file.fileName,
                    type: 'line',
                    showInLegend: true,
                    dataPoints: getKeyDataPoints(data, isNoZero, comparisonStep, rangesLength[index])
                })
                parseKey[index].push(key);
            }
        }
    }
    return [parseKeyData, parseKey];
}

function getChartTitle(parseKeys){
    parseKeys = Array.from(new Set(parseKeys));
    let chartTitle = [];
    for(let index in parseKeys){
        let keyTitle = parseKeys[index].replace(/[^a-zA-Z0-9()\s]/g, ' ').trim();
        keyTitle = keyTitle.charAt(0).toUpperCase() + keyTitle.slice(1);
        chartTitle.push(keyTitle);
    }
    return chartTitle.join('/') + ' Chart';
}

function updateParseKeyChart(files){
    let comparisonStep = getComparisonStep();
    let isNoZero = document.getElementById("removeZeros").checked;
    let parseKeyData = prepareParseKeyChartData(files, isNoZero, comparisonStep);
    let parseKeys = parseKeyData[1];
    parseKeyData = parseKeyData[0];
    let lossCharts = document.getElementById("lossCharts");
    let charts = [];
    lossCharts.replaceChildren();

    for(let index in parseKeyData){
        let chartTitle = getChartTitle(parseKeys[index]);
        let chartOptions = {
            zoomEnabled: true,
            animationEnabled: true,
            title: { text: chartTitle},
            axisY: { lineThickness: 1 },
            data: parseKeyData[index]
        };

        let parseKeyDiv = document.createElement("div");
        parseKeyDiv.classList.add("parseKeyDiv");
        parseKeyDiv.setAttribute("name", "parseKeyDiv" + index);
        lossCharts.appendChild(parseKeyDiv);

        let chartDiv = document.createElement("div");
        chartDiv.classList.add("parseKeyChartDiv");
        parseKeyDiv.appendChild(chartDiv);
        charts.push(new CanvasJS.Chart(chartDiv, chartOptions))
    }

    document.getElementById("uploadDiv").style.display = "none";
    if(Object.keys(parseKeyData).length > 0){
        lossCharts.style.display = "flex";
    }else{
        lossCharts.style.display = "none";
    }

    for(let i in charts){
        charts[i].render();
    }
}

function prepareComparisonChartData(comparisonData, comparisonType){
    let comparisonChartData = [];
    for (let index in comparisonData){
        let options = {
            zoomEnabled: true,
            animationEnabled: true,
            title: {text: "Comparison " + comparisonType.replace("_", " ") + " Chart"},
            axisY: {lineThickness: 1},
            data: [{
                name: "Error",
                type: "line",
                showInLegend: true,
                dataPoints: comparisonData[index].getDataByComparisonType(comparisonType)
            }]
        };

        if(comparisonType === "relative_normal"){
            options.data.push({
                name: "Positive baseline",
                type: "line",
                showInLegend: true,
                color: "FireBrick",
                lineColor: "FireBrick",
                dataPoints: comparisonData[index].relative_normal_baseline_positive
            });
            options.data.push({
                name: "Negative baseline",
                type: "line",
                showInLegend: true,
                color: "FireBrick",
                lineColor: "FireBrick",
                dataPoints: comparisonData[index].relative_normal_baseline_negative
            });
        }else if(comparisonType === "relative_abs"){
            options.data.push({
                name: "Baseline",
                type: "line",
                showInLegend: true,
                color: "FireBrick",
                lineColor: "FireBrick",
                dataPoints: comparisonData[index].relative_abs_baseline
            });
        }
        let meanErrorInfo = comparisonData[index].getMeanErrorInfo(comparisonType);
        comparisonChartData.push({chartOptions: options, meanErrorInfo: meanErrorInfo});
    }
    return comparisonChartData;
}

function updateComparisonChart(comparisonData, comparisonType){
    let lossCharts = document.getElementById("lossCharts");
    let comparisonChartData = prepareComparisonChartData(comparisonData, comparisonType);
    for(let index in comparisonData){
        let parseKeyDiv = lossCharts.querySelector(`div[name="parseKeyDiv${index}"]`)
        if(parseKeyDiv != null){
            let chartDiv = document.createElement("div");
            chartDiv.classList.add("parseKeyChartDiv");
            parseKeyDiv.appendChild(chartDiv);
            new CanvasJS.Chart(chartDiv, comparisonChartData[index]["chartOptions"]).render();

            let meanErrorDiv = document.createElement("div");
            meanErrorDiv.innerText = comparisonChartData[index]["meanErrorInfo"];
            meanErrorDiv.classList.add("meanError");
            parseKeyDiv.appendChild(meanErrorDiv);
        }
    }
}