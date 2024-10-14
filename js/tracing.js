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

function removeLogClickHandler(fileName) {
    tracingParser.removeFile(fileName);
}

function checkboxClickHandler(event) {
    tracingParser.updateLogVisible(event.name, event.checked)
}

function readFile(file) {
    let reader = new FileReader();
    reader.onload = (function (file) {
        return function (e) {
            tracingParser.addFile(file.name.trim(), e.target.result)
        }
    })(file);
    reader.readAsText(file);
}

const OpType = Object.freeze({
    NONE: 0,
    VECTOR: 1,
    CUBE: 2,
    FA: 3,
    COMM: 4,
    MEM: 5
});

function getOpTypeAndName(item) {
    if (!("args" in item)) {
        return [OpType.NONE, String(null)];
    }
    let taskType = item["args"]["Task Type"];
    if (taskType === "AI_CORE" || taskType === "AICPU" || taskType === "MIX_AIC") {
        let operatorName = item["name"].split('_')
        operatorName = operatorName[operatorName.length - 1]
        let operatorNameLowercase = operatorName.toLowerCase()
        if (operatorNameLowercase.includes("matmul") || operatorNameLowercase.includes('conv')) {
            return [OpType.CUBE, operatorName];
        } else if (operatorNameLowercase.includes("flashattention")) {
            return [OpType.FA, operatorName];
        } else {
            return [OpType.VECTOR, operatorName];
        }
    } else if (item['name'].startsWith('hcom')) {
        let operatorName = item["name"].split('_')[1]
        return [OpType.COMM, operatorName]
    }
    return [OpType.NONE, String(null)]
}


function getOpTypeAndNameGPU(item) {
    if (!'cat' in item || !['kernel', 'gpu_memcpy', 'gpu_memset'].includes(item['cat'])) {
        return [OpType.NONE, String(null)];
    }

    let operatorName = item['name']
    let operatorNameLowercase = operatorName.toLowerCase()
    if (['gpu_memcpy', 'gpu_memset'].includes(item['cat'])) {
        return [OpType.MEM, operatorName.split(' ')[0]]
    } else if (operatorNameLowercase.startsWith('ncclkernel')) {
        return [OpType.COMM, operatorName.split('_')[1]]
    } else if (operatorNameLowercase.includes('gemm')) {
        return [OpType.CUBE, operatorName.split('_')[2]]
    } else if (operatorNameLowercase.includes('flash')) {
        let startIndex = operatorNameLowercase.indexOf('flash');

        return [OpType.FA, operatorName.substring(startIndex, startIndex + 11)]
    } else {
        if (operatorNameLowercase.startsWith('cudacodegen')) {
            operatorName = operatorName.split('(')[0];
        } else {
            operatorName = operatorName.split('<')[0].split('::');
            operatorName = operatorName[operatorName.length - 1];
        }
        return [OpType.VECTOR, operatorName];
    }
}

function getWithDefault(map, key, defaultValue) {
    if (!map.has(key)) {
        map.set(key, defaultValue);
    }
    return map.get(key);
}

function getSorted(unsortedMap, reverse) {
    let sortedList = []
    const iterator1 = unsortedMap[Symbol.iterator]();
    for (const item of iterator1) {
        sortedList.push(item);
    }
    sortedList.sort(function (first, second) {
        if (first[1] === second[1]) {
            return 0;
        }
        if (reverse) {
            return first[1] < second[1] ? 1 : -1;
        } else {
            return first[1] > second[1] ? 1 : -1;
        }

    })
    return sortedList;
}

function timeSummary(tracingData) {
    let jsonObj = tracingData.jsonObj
    let opsTime = new Map();
    let startTime = parseFloat(jsonObj[0]["ts"]);
    let endTime = parseFloat(jsonObj[0]["ts"]);
    let commTime = 0
    let commNotOverlapTime = 0
    let commGroupName = new Map();
    let commGroupTime = new Map();
    let commOpsTime = new Map();
    let commGroupOps = new Map();

    let computeTime = 0
    let freeTime = 0
    let cubeTime = 0
    let vectorTime = 0
    let faTime = 0


    function parserE2ETime(item) {
        if ("ts" in item && item['name'] !== 'AI Core Freq' && !item['name'].includes('PROFILING')) {
            let thisTime = parseFloat(item["ts"])
            startTime = Math.min(startTime, thisTime);
            endTime = Math.max(endTime, thisTime);
            if ("dur" in item) {
                let dur = parseFloat(item["dur"]);
                endTime = Math.max(endTime, thisTime + dur);
            }
        }
    }

    function parserRatios(item, duration) {
        let itemName = item['name']
        switch (itemName) {
            case 'Computing':
                computeTime += duration;
                break;
            case 'Communication':
                commTime += duration;
                break;
            case 'Communication(Not Overlapped)':
                commNotOverlapTime += duration;
                break;
            case 'Free':
                freeTime += duration;
                break;
        }
    }

    function parserOp(item, duration) {
        let [opType, opName] = getOpTypeAndName(item);
        switch (opType) {
            case OpType.CUBE:
                cubeTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                break;
            case OpType.VECTOR:
                vectorTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                break;
            case OpType.FA:
                faTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                break;
            case OpType.COMM:
                let tid = item['tid']
                if(commGroupOps.has(tid)){
                    commGroupOps.get(tid).push(item);
                }else{
                    commGroupOps.set(tid, [item]);
                }
                commGroupTime.set(tid, getWithDefault(commGroupTime, tid, 0) + duration);
                commOpsTime.set(opName, getWithDefault(commOpsTime, opName, 0) + duration)
        }
    }

    function parserCommGroup(item) {
        if (item['name'] === 'thread_name' && item['args']['name'].startsWith('Group') && item['args']['name'].endsWith('Communication')) {
            if (!commGroupName.has(item['tid'])) {
                commGroupName.set(item['tid'], item['args']['name'])
            }
        }
    }

    jsonObj.forEach(item => {
        let duration = parseFloat(item["dur"])
        // parserE2ETime(item);  # dont work if profile has problem
        parserRatios(item, duration);
        parserOp(item, duration);
        parserCommGroup(item);
    })


    // let sortedOps = Object.keys(opsTime).map(function (key){return [key, opsTime[key]]});
    // let totalTime = endTime - startTime;

    tracingData.totalTime = computeTime + commNotOverlapTime + freeTime;
    tracingData.computeTime = computeTime;
    tracingData.commTime = commTime;
    tracingData.commNotOverlapTime = commNotOverlapTime;
    tracingData.freeTime = freeTime;

    tracingData.cubeTime = cubeTime;
    tracingData.faTime = faTime;
    tracingData.vectorTime = vectorTime;
    tracingData.opsTime = opsTime;
    tracingData.sortedOps = getSorted(opsTime, true);

    tracingData.commGroupName = getSorted(commGroupName, false);
    tracingData.commGroupTime = commGroupTime;
    tracingData.commGroupOps = commGroupOps;
    tracingData.sortedCommTime = getSorted(commOpsTime, true);

    console.log("total", tracingData.totalTime);
    console.log("Communication", commTime, "Ratio", commTime / tracingData.totalTime);
    console.log("Communication (Not Overlapped)", commNotOverlapTime, "Ratio", commNotOverlapTime / tracingData.totalTime);
    console.log("Computation", computeTime, "Ratio", computeTime / tracingData.totalTime);
    console.log("Free", freeTime, "Ratio", freeTime / tracingData.totalTime);
    console.log("------------------------------------------------------")
    console.log("Cube Time", cubeTime);
    console.log("Vector Time", vectorTime);
    console.log("FA Time", faTime);
    console.log("------------------------------------------------------")
    console.log(tracingData.commGroupName);
    console.log(commGroupTime);

}

function timeSummaryGPU(tracingData) {
    let jsonObj = tracingData.jsonObj;
    let opsTime = new Map();
    let startTime = Infinity;
    let endTime = -1;
    let commTime = 0;
    let commNotOverlapTime = 0
    let commGroupName = new Map();
    let commGroupTime = new Map();
    let commOpsTime = new Map();
    let commGroupOps = new Map();
    let ops = [];

    let computeTime = 0;
    let computeOps = [];
    let freeTime = 0;
    let cubeTime = 0;
    let vectorTime = 0;
    let faTime = 0;
    let memTime = 0;

    let notOverlap = [];


    function parserE2ETime(item) {
        if ("ts" in item && ['kernel', 'gpu_memcpy', 'gpu_memset'].includes(item['cat'])) {
            let thisTime = parseFloat(item["ts"]);
            startTime = Math.min(startTime, thisTime);
            endTime = Math.max(endTime, thisTime);
            if ("dur" in item) {
                let dur = parseFloat(item["dur"]);
                endTime = Math.max(endTime, thisTime + dur);
            }
        }
    }

    function parserOp(item, duration) {
        let [opType, opName] = getOpTypeAndNameGPU(item);
        switch (opType) {
            case OpType.MEM:
                memTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                computeOps.push(item);
                break;
            case OpType.CUBE:
                cubeTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                computeOps.push(item);
                break;
            case OpType.VECTOR:
                vectorTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                computeOps.push(item);
                break;
            case OpType.FA:
                faTime += duration;
                opsTime.set(opName, getWithDefault(opsTime, opName, 0) + duration);
                computeOps.push(item);
                break;
            case OpType.COMM:
                let tid = item['tid']
                commTime += duration;
                if(commGroupOps.has(tid)){
                    commGroupOps.get(tid).push(item);
                }else{
                    commGroupOps.set(tid, [item]);
                }
                commGroupTime.set(tid, getWithDefault(commGroupTime, tid, 0) + duration);
                commOpsTime.set(opName, getWithDefault(commOpsTime, opName, 0) + duration);
                ops.push(item);
        }
    }

    function parserCommGroup(item) {
        if (item['name'] === 'thread_name' && item['args']['name'].startsWith('stream')) {
            if (!commGroupName.has(item['tid'])) {
                commGroupName.set(item['tid'], item['args']['name']);
            }
        }
    }

    function analysisComputeOps(computeOps) {
        let analysisCompute = [];
        computeOps.forEach(function (item) {
            analysisCompute.push({
                'ph': 'X',
                'name': 'Computing',
                'pid': 'Analysis',
                'tid': 'Computing',
                'ts': item['ts'],
                'dur': item['dur']
            })
        })
        analysisCompute.sort(function (a, b) {
            return a['ts'] - b['ts'];
        });
        return analysisCompute;
    }

    function analysisCommunicationOps(commOps) {
        let tmpOp = null;
        let analysisCommunication = [];
        for (let i = 0; i < commOps.length; i++) {
            if (tmpOp != null && commOps[i]['ts'] > tmpOp['ts'] + tmpOp['dur']) {
                analysisCommunication.push(tmpOp);
                tmpOp = null;
            }
            if (tmpOp == null) {
                tmpOp = Object.assign({}, {
                    'ph': 'X',
                    'name': 'Communication',
                    'pid': 'Analysis',
                    'tid': 'Communication',
                    'ts': commOps[i]['ts'],
                    'dur': commOps[i]['dur']
                });
            } else {
                if (commOps[i]['ts'] + commOps[i]['dur'] > tmpOp['ts'] + tmpOp['dur']) {
                    tmpOp['dur'] = commOps[i]['ts'] + commOps[i]['dur'] - tmpOp['ts'];
                }
            }
        }
        if (tmpOp != null) {
            analysisCommunication.push(tmpOp);
            tmpOp = null;
        }
        return analysisCommunication;
    }

    function analysisNotOverlapOps(analysisCompute, analysisComm) {
        let tmpOp = null;
        let j = 0;
        let analysisNotOverlap = [];
        for (let i = 0; i < analysisComm.length; i++) {
            if (tmpOp == null) {
                tmpOp = Object.assign({}, {
                    'ph': 'X',
                    'name': 'Communication(Not Overlapped)',
                    'pid': 'Analysis',
                    'tid': 'Communication(Not Overlapped)',
                    'ts': analysisComm[i]['ts'],
                    'dur': analysisComm[i]['dur']
                });
            }

            while (j < analysisCompute.length && analysisCompute[j]['ts'] + analysisCompute[j]['dur'] < tmpOp['ts']) {
                j++;
            }

            while (j < analysisCompute.length && tmpOp != null && analysisCompute[j]['ts'] <= (tmpOp['ts'] + tmpOp['dur']) && analysisCompute[j]['ts'] + analysisCompute[j]['dur'] >= tmpOp['ts']) {
                if (tmpOp['ts'] + tmpOp['dur'] <= analysisCompute[j]['ts'] + analysisCompute[j]['dur']) {
                    tmpOp['dur'] = analysisCompute[j]['ts'] - tmpOp['ts'];
                    if (tmpOp['dur'] > 0) {
                        analysisNotOverlap.push(tmpOp);
                    }
                    tmpOp = null;
                } else {
                    if (analysisCompute[j]['ts'] < tmpOp['ts']) {
                        tmpOp['dur'] = tmpOp['ts'] + tmpOp['dur'] - (analysisCompute[j]['ts'] + analysisCompute[j]['dur']);
                        tmpOp['ts'] = analysisCompute[j]['ts'] + analysisCompute[j]['dur'];

                    } else {
                        let newTmpOp = Object.assign({}, tmpOp);
                        tmpOp['dur'] = analysisCompute[j]['ts'] - tmpOp['ts'];
                        if (tmpOp['dur'] > 0) {
                            analysisNotOverlap.push(tmpOp);
                        }
                        newTmpOp['dur'] = newTmpOp['ts'] + newTmpOp['dur'] - (analysisCompute[j]['ts'] + analysisCompute[j]['dur']);
                        newTmpOp['ts'] = analysisCompute[j]['ts'] + analysisCompute[j]['dur'];
                        tmpOp = newTmpOp;
                    }
                    j++;
                }
            }

            if (tmpOp != null) {
                analysisNotOverlap.push(tmpOp);
                tmpOp = null;
            }
        }
        return analysisNotOverlap;
    }

    function analysisFreeOps(analysisCompute, analysisComm, startTime, endTime) {
        // merge compute and communication ops
        let ops = analysisCompute.slice(0);
        ops.push.apply(ops, analysisComm);
        ops.sort(function (a, b) {
            return a['ts'] - b['ts'];
        });

        let allOps = [];
        let tmpOp = null;
        for (let i = 0; i < ops.length; i++) {
            if (tmpOp != null && ops[i]['ts'] > tmpOp['ts'] + tmpOp['dur']) {
                allOps.push(tmpOp);
                tmpOp = null;
            }
            if (tmpOp == null) {
                tmpOp = Object.assign({}, {
                    'ph': 'X',
                    'name': 'Free',
                    'pid': 'Analysis',
                    'tid': 'Free',
                    'ts': ops[i]['ts'],
                    'dur': ops[i]['dur']
                });
            } else {
                if (ops[i]['ts'] + ops[i]['dur'] > tmpOp['ts'] + tmpOp['dur']) {
                    tmpOp['dur'] = ops[i]['ts'] + ops[i]['dur'] - tmpOp['ts'];
                }
            }
        }
        if (tmpOp != null) {
            allOps.push(tmpOp);
            tmpOp = null;
        }

        // analysis free
        let analysisFree = [];
        tmpOp = {
            'ph': 'X',
            'name': 'Free',
            'pid': 'Analysis',
            'tid': 'Free',
            'ts': startTime,
            'dur': endTime - startTime
        }
        for (let i = 0; i < allOps.length; i++) {
            tmpOp['dur'] = allOps[i]['ts'] - tmpOp['ts'];
            if (tmpOp['dur'] > 0) {
                analysisFree.push(Object.assign({}, tmpOp));
            }
            tmpOp['ts'] = allOps[i]['ts'] + allOps[i]['dur'];
            tmpOp['dur'] = 0;
        }
        if (tmpOp['dur'] > 0) {
            analysisFree.push(Object.assign({}, tmpOp));
        }
        return analysisFree;
    }

    function sumDuration(ops) {
        let sum = 0;
        ops.forEach(function (item) {
            sum += item['dur'];
        });
        return sum;
    }

    jsonObj['traceEvents'].forEach(item => {
        let duration = parseFloat(item["dur"])
        parserE2ETime(item);
        parserOp(item, duration);
        parserCommGroup(item);
    });


    ops.sort(function (a, b) {
        return a['ts'] - b['ts'];
    });


    tracingData.analysisCompute = analysisComputeOps(computeOps);
    tracingData.analysisComm = analysisCommunicationOps(ops);
    tracingData.analysisNotOverlap = analysisNotOverlapOps(tracingData.analysisCompute, tracingData.analysisComm);
    tracingData.analysisFree = analysisFreeOps(tracingData.analysisCompute, tracingData.analysisComm, startTime, endTime);

    tracingData.totalTime = endTime - startTime;

    tracingData.computeTime = sumDuration(tracingData.analysisCompute);
    tracingData.commTime = sumDuration(tracingData.analysisComm);
    tracingData.commNotOverlapTime = sumDuration(tracingData.analysisNotOverlap);
    tracingData.freeTime = sumDuration(tracingData.analysisFree);

    console.assert(tracingData.computeTime === cubeTime + faTime + vectorTime + memTime);
    console.assert(tracingData.commNotOverlapTime === tracingData.totalTime - tracingData.computeTime - tracingData.freeTime);
    console.assert(tracingData.freeTime === tracingData.totalTime - tracingData.computeTime - tracingData.commNotOverlapTime);
    console.log(tracingData.computeTime + tracingData.commNotOverlapTime + tracingData.freeTime);

    tracingData.cubeTime = cubeTime;
    tracingData.faTime = faTime;
    tracingData.vectorTime = vectorTime + memTime;
    tracingData.opsTime = opsTime;
    tracingData.sortedOps = getSorted(opsTime, true);

    tracingData.commGroupName = getSorted(commGroupName, false);
    tracingData.commGroupTime = commGroupTime;
    tracingData.commGroupOps = commGroupOps;
    tracingData.sortedCommTime = getSorted(commOpsTime, true);

    jsonObj['traceEvents'].push.apply(jsonObj['traceEvents'], tracingData.analysisCompute)
    jsonObj['traceEvents'].push.apply(jsonObj['traceEvents'], tracingData.analysisComm)
    jsonObj['traceEvents'].push.apply(jsonObj['traceEvents'], tracingData.analysisNotOverlap)
    jsonObj['traceEvents'].push.apply(jsonObj['traceEvents'], tracingData.analysisFree)
    console.log(tracingData.analysisCompute.length, tracingData.analysisComm.length, tracingData.analysisNotOverlap.length, tracingData.analysisFree.length)

    console.log(computeOps);
    console.log("total", tracingData.totalTime);
    console.log("Communication", tracingData.commTime, "Ratio", tracingData.commTime / tracingData.totalTime);
    console.log("Communication (Not Overlapped)", tracingData.commNotOverlapTime, "Ratio", tracingData.commNotOverlapTime / tracingData.totalTime);
    console.log("Computation", tracingData.computeTime, "Ratio", tracingData.computeTime / tracingData.totalTime);
    console.log("Free", tracingData.freeTime, "Ratio", tracingData.freeTime / tracingData.totalTime);
    console.log("------------------------------------------------------")
    console.log("Cube Time", tracingData.cubeTime);
    console.log("Vector Time", tracingData.vectorTime);
    console.log("FA Time", tracingData.faTime);

    console.log("Compute Time", tracingData.cubeTime + tracingData.vectorTime + tracingData.faTime);
    console.log(jsonObj)
    console.log(tracingData.commGroupName, tracingData.commGroupTime)
}


class TracingParser {
    constructor() {
        this.files = {};
        this.topK = 5;
        this.toFixedNum = 2;
        this.warningLevel1 = 1000;  // 1ms
    }

    addFile(fileName, fileText) {
        while (fileName in this.files) {
            if (/\(\d+\)$/.test(fileName)) {
                let leftIndex = fileName.lastIndexOf('(');
                let rightIndex = fileName.lastIndexOf(')');
                let num = parseInt(fileName.substring(leftIndex + 1, rightIndex));
                fileName = fileName.substring(0, leftIndex) + '(' + (num + 1) + ')'
            } else {
                fileName = fileName + '(1)';
            }
        }

        if (!(fileName in this.files)) {
            this.files[fileName] = {
                fileName: fileName,
                jsonObj: null,
            }
            let div = document.createElement('div');
            div.innerHTML = `
            <div class="checkboxDiv" id="selectLog_` + fileName + `">
                <input type="checkbox" id="` + fileName + `" name="` + fileName + `" value="` + fileName + `" onclick='checkboxClickHandler(this);' checked>
                <div class="marquee"><label class="checkboxText" for="` + fileName + `">` + fileName + `</label></div>
                <img src="img/delete.png" width="20px" height="20px" style="padding-left: 10px"  alt="setting" onclick='removeLogClickHandler("` + fileName + `");'/>
            </div>
            `
            document.getElementById("selectLogs").appendChild(div);
            // div.addEventListener('mouseout', function (e) {
            //     resetLossSummary();
            // })
            this.files[fileName].visible = true;
        }
        this.files[fileName].jsonObj = JSON.parse(fileText);
        if ('deviceProperties' in this.files[fileName].jsonObj) {
            this.files[fileName].isNPU = false;
            timeSummaryGPU(this.files[fileName]);
        } else {
            this.files[fileName].isNPU = true;
            timeSummary(this.files[fileName]);
        }

        this.plotTable();
        document.getElementById("uploadDiv").style.display = 'none';
        document.getElementById("tableDiv").style.display = 'block';
    }

    plotTable() {
        let maxGroupNum = 0;
        let baselineFileName = null;
        for (let key in this.files) {
            if (this.files[key].visible) {
                if (baselineFileName == null) {
                    baselineFileName = key
                }
                maxGroupNum = Math.max(maxGroupNum, this.files[key].commGroupTime.size);
            }
        }
        document.getElementById('tableHead').innerHTML = '';
        document.getElementById('tableBody').innerHTML = '';
        let commColumn = document.getElementsByTagName("style")

        this.creteHeaders(maxGroupNum)
        for (let key in this.files) {
            if (this.files[key].visible) {
                let table = document.getElementById('tableBody');
                table.appendChild(this.createRow(this.files[key], maxGroupNum, baselineFileName));
            }
        }
    }

    creteHeaders(maxGroupNum) {
        let tableHead = document.getElementById('tableHead');
        let head = document.createElement('tr');

        let headersName1 = [
            ['', 1],
            ['Compute Time<br>(ms/compute ratio/e2e ratio)', 5],
            ['Communication Time<br>(ms/comm ratio/e2e ratio)', maxGroupNum + 3],
            ['Free<br>(ms/e2e ratio)', 1],
            ['E2E<br>(ms/baseline)', 1]
        ]

        headersName1.forEach((headName) => {
            let thElement = document.createElement('th');
            thElement.innerHTML = headName[0];
            thElement.setAttribute('colspan', headName[1]);
            head.appendChild(thElement);
        });
        tableHead.appendChild(head);

        // Second head
        let tableBody = document.getElementById('tableBody');
        let row = document.createElement('tr');

        // Compute headers
        let headersName2 = ['File name', 'Cube', 'Vector', 'FA', 'Total', 'Top ' + this.topK]

        // Communication headers
        for (let i = 0; i < maxGroupNum; i++) {
            headersName2.push('Group ' + i);
        }
        headersName2.push.apply(headersName2, ['Not overlap', 'Total', 'Top ' + this.topK]);

        // Free
        headersName2.push('Total');

        // Total
        headersName2.push('Total');

        // Create html
        headersName2.forEach((name) => {
            let thElement = document.createElement('th');
            thElement.innerHTML = name;
            if(name.startsWith('Group')){
                thElement.addEventListener('click', function (e) {
                    tracingParser.downloadCommGroupJSON(name);
                });
            }
            row.appendChild(thElement);
        });
        tableBody.appendChild(row);
    }

    createRow(tracingData, maxGroupNum, baselineFileName) {
        let baseline = this.files[baselineFileName];
        let row = document.createElement('tr');

        let fileName = document.createElement('td');
        let fileNameLink = document.createElement('a');
        fileNameLink.textContent = tracingData.fileName;
        if (tracingData.fileName === baselineFileName) {
            fileNameLink.innerHTML += '<br>(baseline)'
            // fileName.style.color = 'rgba(0, 0, 255)';
            // fileNameLink.style.textDecoration = 'underline';
        }
        if(!tracingData.isNPU){
            fileNameLink.addEventListener('click', function (e) {
                tracingParser.downloadJSON(tracingData.fileName);
            })
        }
        fileName.appendChild(fileNameLink);
        row.appendChild(fileName);

        // Compute time
        let computeTableList = ['cubeTime', 'vectorTime', 'faTime', 'computeTime']
        computeTableList.forEach((timeName) => {
            let tdElement = document.createElement('td');
            this.setWarningLevel(tdElement, tracingData[timeName], baseline[timeName]);
            tdElement.innerHTML = this.getTimeAndRatio(tracingData[timeName], tracingData.computeTime, tracingData.totalTime);
            row.appendChild(tdElement);
        })

        let computeTopK = document.createElement('td');
        computeTopK.innerHTML = this.getTopKOps(this.topK, tracingData.sortedOps, tracingData.computeTime, tracingData.totalTime);
        row.appendChild(computeTopK);

        // Communication time
        for (let i = 0; i < maxGroupNum; i++) {
            let tdElement = document.createElement('td');
            let commTime = 0;
            if (i < tracingData.commGroupName.length) {
                commTime = tracingData.commGroupTime.get(tracingData.commGroupName[i][0]);
                if (baseline.commGroupName.length > i) {
                    this.setWarningLevel(tdElement, commTime, baseline.commGroupTime.get(baseline.commGroupName[i][0]));
                }

            }
            tdElement.innerHTML = this.getTimeAndRatio(commTime, tracingData.commTime, tracingData.totalTime);
            row.appendChild(tdElement);
        }

        let notOverlap = document.createElement('td');
        notOverlap.innerHTML = this.getTimeAndRatio(tracingData.commNotOverlapTime, tracingData.commTime, tracingData.totalTime)
        this.setWarningLevel(notOverlap, tracingData.commNotOverlapTime, baseline.commNotOverlapTime);
        row.appendChild(notOverlap);

        let commTotal = document.createElement('td');
        commTotal.innerHTML = this.getTimeAndRatio(tracingData.commTime, tracingData.commTime, tracingData.totalTime)
        this.setWarningLevel(commTotal, tracingData.commTime, baseline.commTime);
        row.appendChild(commTotal);

        let commTopK = document.createElement('td');
        commTopK.innerHTML = this.getTopKOps(this.topK, tracingData.sortedCommTime, tracingData.commTime, tracingData.totalTime);
        row.appendChild(commTopK);

        // Free time
        let freeTime = document.createElement('td');
        freeTime.innerHTML = this.getTimeAndRatio(tracingData.freeTime, null, tracingData.totalTime);
        this.setWarningLevel(freeTime, tracingData.freeTime, baseline.freeTime);
        row.appendChild(freeTime);

        // Total time
        let totalTime = document.createElement('td');
        totalTime.innerHTML = (tracingData.totalTime / 1000).toFixed(this.toFixedNum) + 'ms<br>'
        if (tracingData.fileName !== baselineFileName) {
            let percentage = ((tracingData.totalTime / baseline.totalTime) * 100).toFixed(this.toFixedNum);
            if (percentage > 100) {
                totalTime.innerHTML += '-' + (percentage - 100).toFixed(this.toFixedNum) + '% ↓';
            } else if (percentage < 100) {
                totalTime.innerHTML += (100 - percentage).toFixed(this.toFixedNum) + '% ↑';
                totalTime.style.background = 'rgba(0, 255, 0, 0.05)';
            } else {
                totalTime.innerHTML += '0% -';
            }
        }
        this.setWarningLevel(totalTime, tracingData.totalTime, baseline.totalTime);
        row.appendChild(totalTime);
        return row;
    }

    setWarningLevel(element, time, baseline) {
        let gap = time - baseline;
        if (gap > this.warningLevel1) {
            element.className = 'performanceWarningLevel1';
        } else if (gap > 0) {
            element.className = 'performanceWarningLevel0';
        }
    }

    getTimeAndRatio(duration, total, e2eTotal) {
        let ret = (duration / 1000).toFixed(this.toFixedNum) + 'ms<br>';
        if (total != null) {
            ret += ((duration / total) * 100).toFixed(this.toFixedNum) + '%<br>'
        }
        ret += ((duration / e2eTotal) * 100).toFixed(this.toFixedNum) + '%';
        return ret;
    }

    getTopKOps(k, topOps, total, e2eTotal) {
        let s = ''
        for (let i = 0; i < k && i < topOps.length; i++) {
            s += '<div class="marquee"><p class="topOps">' + topOps[i][0] + ' (' + (topOps[i][1] / 1000).toFixed(this.toFixedNum) + 'ms/'
                + ((topOps[i][1] / total) * 100).toFixed(this.toFixedNum) + '%/'
                + ((topOps[i][1] / e2eTotal) * 100).toFixed(this.toFixedNum) + '%)</p></div>';
        }
        return s;
    }

    removeFile(fileName) {
        if (fileName in this.files) {
            document.getElementById("selectLog_" + fileName).remove();
            delete this.files[fileName];
            this.plotTable();
            if (Object.keys(this.files).length === 0) {
                document.getElementById("uploadDiv").style.display = 'block';
                document.getElementById("tableDiv").style.display = 'none';
            }
        }
    }

    updateLogVisible(fileName, visible) {
        this.files[fileName].visible = visible;
        this.plotTable();
    }

    downloadJSON(fileName) {
        let a = document.createElement("a");
        let file = new Blob([JSON.stringify(this.files[fileName].jsonObj)], {type: 'text/plain'});
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
    }

    downloadCommGroupJSON(groupName){
        let commOp=[];
        let groupID = parseInt(groupName.split(' ')[1]);
        for (let key in this.files) {
            if (this.files[key].visible && this.files[key].commGroupName.length > groupID) {
                commOp.push.apply(commOp, this.files[key].commGroupOps.get(this.files[key].commGroupName[groupID][0]));
            }
        }
        if(commOp.length > 0){
            let a = document.createElement("a");
            let file = new Blob([JSON.stringify(commOp)], {type: 'text/plain'});
            a.href = URL.createObjectURL(file);
            a.download = groupName + '.json';
            a.click();
        }
    }
}


tracingParser = new TracingParser();
