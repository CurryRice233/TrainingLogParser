
function readFile(file) {
    let reader = new FileReader();
    reader.onload = (function (file) {
        return function (e) {
            logParser.addFile(file.name.trim(), e.target.result)
        }
    })(file);
    reader.readAsText(file);
}


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

function settingClickHandler(fileName) {
    let dialog = document.getElementById('dialogDiv');
    if (typeof dialog.showModal === "function") {
        document.getElementById('dialogTitle').innerText = fileName;

        let context = ''
        for(let parseKey in logParser.files[fileName].keyDatas){
            let keyData = logParser.files[fileName].keyDatas[parseKey]
            context = context + `[${parseKey}] ${keyData.parsedData.length} times, ${keyData.dataNoZero.length} times(without zeros/neg.)\n`
        }

        document.getElementById('dialogContext').innerText = context.trim()
        document.getElementById('parserKeyText').value = logParser.files[fileName].dataKeysString;

        let end = logParser.files[fileName].rangeEnd
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
    logParser.setFileSetting(
        document.getElementById('dialogTitle').innerText,
        document.getElementById('parserKeyText').value,
        document.getElementById('lossRangeText').value,
        document.getElementById('regex').checked
    );
}

function checkboxClickHandler(event){
    logParser.updateFileVisible(event.name, event.checked)
}

function comparisonRadioHandler(comparisonType) {
    logParser.updateComparisonType(comparisonType)
}

class LogParser {
    constructor() {
        this.files = {};
        this.cookies = {};
        this.defaultParseKeys = 'loss:';
        this.comparisonType = 'normal';
        this.relative_baseline = 0.02;

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
            this.files[fileName] = new FileData(fileName, fileText);
            this.files[fileName].visible = true;
            addFileDiv(fileName, this.files[fileName])
        }
        this.files[fileName].updateKeys(this.getInitParseKeys(fileName));
        this.updateChart();
    }

    updateFileVisible(fileName, visible){
        this.files[fileName].visible = visible;
        this.updateChart();
    }

    getInitParseKeys(fileName){
        let keys;
        let globalParseKey = getGlobalParseKey();
        let autoIdent = this.files[fileName].autoIdentificationFramework();
        if (globalParseKey !== ''){
            keys = globalParseKey
        }else if(fileName in this.cookies){
            keys = this.cookies[fileName];
        }else if(autoIdent !== null){
            keys = autoIdent;
        }else{
            keys = this.defaultParseKeys;
        }
        this.cookies[fileName] = keys;
        return keys;
    }

    setGlobalLossTag(keys){
        for(let key in this.files){
            this.files[key].updateKeys(keys)
        }
        this.updateChart();
    }

    setFileSetting(fileName, parseKeys, rangeTag, regex){
        let file = this.files[fileName];
        file.updateKeys(parseKeys, regex);
        let range = rangeTag.split(":");
        file.setDataRange(parseInt(range[0]), parseInt(range[1]));
        this.updateChart();
    }

    processComparisonData(){
        let comparisonDatas = []
        let comparisonFiles = []
        for(let fileName in this.files){
            if(this.files[fileName].visible){
                comparisonFiles.push(this.files[fileName]);
            }
        }
        if(comparisonFiles.length === 2 && !isDisableComparison()){
            comparisonFiles.sort();
            let comparisonStep = getComparisonStep();
            let noZero = isNoZero();

            let keyLength = Math.min(comparisonFiles[0].parsedKeys.length, comparisonFiles[1].parsedKeys.length)
            for(let index=0; index<keyLength; index++){
                comparisonDatas.push(new ComparisonData(
                    comparisonFiles[0].keyDatas[comparisonFiles[0].parsedKeys[index]],
                    comparisonFiles[1].keyDatas[comparisonFiles[1].parsedKeys[index]],
                    comparisonStep, this.relative_baseline, noZero
                ));
            }
        }
        return comparisonDatas
    }

    updateComparisonType(comparisonType){
        this.comparisonType = comparisonType;
        this.updateChart();
    }

    updateChart(){
        updateParseKeyChart(this.files);
        let comparisonDatas = this.processComparisonData();
        if(comparisonDatas.length > 0){
            updateComparisonChart(comparisonDatas, this.comparisonType);
        }
        this.saveParseKeysToCookie();
    }

    removeFile(fileName) {
        if(fileName in this.files) {
            document.getElementById("selectLog_" + fileName).remove();
            delete this.files[fileName]
            clearDataMaxMinMean();
            this.updateChart();
        }
    }

    saveParseKeysToCookie() {
        for(let fileName in this.files){
            this.cookies[fileName] = this.files[fileName].dataKeysString;
        }

        for (let cookie in this.cookies) {
            if (window.location.hostname === 'openx.huawei.com') {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/project/1738";
            } else {
                document.cookie = cookie + "=" + this.cookies[cookie] + ";path=/";
            }
        }
    }

    downloadCSV(fileName) {
        let csvContent = 'data:text/csv;charset=utf-8,' + this.files[fileName].getCSVContext();
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", fileName + '.csv');
        link.click();
    }
}


logParser = new LogParser();

