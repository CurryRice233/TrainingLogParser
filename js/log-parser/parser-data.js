const numberRegExp = new RegExp('[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?');

function getMeanError(erros){
    let me = 0.0;
    let mse = 0.0;
    for(let i = 0; i < erros.length; i++){
        me += erros[i].y;
        mse += erros[i].y * erros[i].y;
    }
    return [me / erros.length, mse / erros.length]
}

function getMaxMinMean(array){
    let min = null;
    let max = null;
    let sum = 0;
    for (let i = 0; i < array.length; i++){
        if (min == null || min > array[i]) {
            min = array[i];
        }
        if (max == null || max < array[i]) {
            max = array[i];
        }
        sum += array[i];
    }
    return [min, max, sum / array.length]
}

class KeyData {
    constructor(key, isRegex) {
        this.key = key
        this.isRegex = isRegex
        this.parsedData = [];
        this.dataNoZero = [];
        this.rangeData = [];
        this.rangeDataNoZero = [];
        this.rangeDataMin = 0;
        this.rangeDataMax = 0;
        this.rangeDataMean = 0;
        this.rangeDataNoZeroMin = 0;
        this.rangeDataNoZeroMax = 0;
        this.rangeDataNoZeroMean = 0;
        this.rangeStart = 0;
        this.rangeEnd = null;

        if (this.isRegex) {
            this.key = new RegExp(this.key)
        }
    }

    parseText(text) {
        for (let i = 0; i < text.length; i++) {
            this.parseLine(text[i]);
        }
        this.setDataRange(0, this.parsedData.length);
    }

    parseLine(line) {
        let loss;
        if (!this.isRegex) {
            loss = this.parseLineByFind(line);
        } else {
            loss = this.parseLossByRegex(line);
        }
        if (loss != null && !isNaN(loss)) {
            this.parsedData.push(loss);
            if (loss > 0) {
                this.dataNoZero.push(loss);
            }
        }
    }

    parseLineByFind(line) {
        let pos = line.indexOf(this.key);
        let loss = null;
        if (pos !== -1) {
            let res = numberRegExp.exec(line.substring(pos + this.key.length).trim().split(/\s+/)[0]);
            if (res != null) {
                loss = parseFloat(res[0]);
            } else {
                console.log(`Found text ${this.key}, but error parse value with: [${line}]`);
            }
        }
        return loss;
    }

    parseLossByRegex(line) {
        let loss = null;
        let res = this.key.exec(line);
        if (res != null) {
            loss = parseFloat(res[0]);
        }
        return loss;
    }

    setDataRange(start, end) {
        this.rangeStart = start;
        this.rangeEnd = end;
        this.rangeData = this.parsedData.slice(this.rangeStart, this.rangeEnd);
        this.rangeDataNoZero = this.dataNoZero.slice(this.rangeStart, this.rangeEnd);
        this.processMaxMinMean();
    }

    processMaxMinMean() {
        let res = getMaxMinMean(this.rangeData);
        this.rangeDataMin = res[0];
        this.rangeDataMax = res[1];
        this.rangeDataMean = res[2];
        res = getMaxMinMean(this.rangeDataNoZero);
        this.rangeDataNoZeroMin = res[0];
        this.rangeDataNoZeroMax = res[1];
        this.rangeDataNoZeroMean = res[2];
    }

    getData(isNoZero) {
        if(!isNoZero) {
            return this.rangeData
        }
        return this.rangeDataNoZero
    }

    getDataInfo(isNoZero){
        if(!isNoZero){
            return `Count: ${this.rangeData.length}, Max:${this.rangeDataMax}, Min:${this.rangeDataMin}, Mean:${this.rangeDataMean}`
        }else{
            return `Count: ${this.rangeDataNoZero.length}, Max:${this.rangeDataNoZeroMax}, Min:${this.rangeDataNoZeroMin}, Mean:${this.rangeDataNoZeroMean}`
        }
    }
}

class FileData {
    constructor(fileName, fileText){
        this.fileName = fileName;
        this.fileTextOri = fileText;
        this.fileText = fileText.split(/\n|\r\n/);
        this.dataKeysString = null;
        this.parsedKeys = null;
        this.keyDatas = {};
        this.rangeStart = 0;
        this.rangeEnd = null;
    }

    setDataRange(start, end) {
        for(let key in this.keyDatas){
            this.keyDatas[key].setDataRange(start, end);
        }
        this.rangeStart = start;
        this.rangeEnd = end;
    }

    parseKeys(keys){
        if (keys[0] === '['){
            keys = JSON.parse(keys)
        } else {
            keys = [keys]
        }
        return keys;
    }

    updateKeys(keys, isRegExp) {
        this.dataKeysString = keys
        this.parsedKeys = this.parseKeys(keys)
        this.keyDatas = {};
        this.rangeStart = 0;
        this.rangeEnd = null;
        for (let i = 0; i < this.parsedKeys.length; i++) {
            this.parseKeyData(this.parsedKeys[i], isRegExp);
        }
        for(let key in this.keyDatas){
            if(this.rangeEnd == null || this.rangeEnd < this.keyDatas[key].rangeEnd){
                this.rangeEnd = this.keyDatas[key].rangeEnd;
            }
        }
    }

    parseKeyData(key, isRegExp){
        this.keyDatas[key] = new KeyData(key, isRegExp);
        this.keyDatas[key].parseText(this.fileText);
    }

    autoIdentificationFramework() {
        const frameworkIdentification = {
            '["loss:","grad norm:"]': ["loss:","grad norm:"],
            '["critic/rewards/mean:","actor/grad_norm:","actor/kl_loss","response_length/mean:"]': ["critic/rewards/mean:","actor/grad_norm:", "actor/kl_loss", "response_length/mean:"],
            '["\'reward\':","\'loss\':","\'completions/mean_length\':","\'kl\':"]': ["'reward':","'loss':","'completions/mean_length':","'kl':"]
        }
        for (let key in frameworkIdentification) {
            let found = true;
            for (let j in frameworkIdentification[key]) {
                if (this.fileTextOri.indexOf(frameworkIdentification[key][j]) === -1) {
                    found = false;
                }
            }
            if(found){
                return key;
            }
        }
        return null;
    }

    getCSVContext(){
        let header = []
        let dataArray = []
        let text;
        for(let key in this.keyDatas){
            let keyCSV = key.replace(/"/g, '""')
            header.push(`"${keyCSV}", "${keyCSV}(No Zero/Neg.)"`)
            dataArray.push(this.keyDatas[key].rangeData);
            dataArray.push(this.keyDatas[key].rangeDataNoZero);
        }
        text = header.join(',') + '\n';
        let maxLength = Math.max(...dataArray.map(arr => arr.length));
        text = text + Array.from({ length: maxLength }, (_, i) =>
            dataArray.map(arr => {
                const val = arr[i] === undefined ? '' : String(arr[i]).replace(/"/g,'""');
                return `"${val}"`;
            }).join(',')
        ).join('\n');
        return text
    }
}

class ComparisonData {
    constructor(file1, file2, comparisonStep, relative_baseline, isNoZero) {
        this.file1 = file1
        this.file2 = file2
        this.comparisonStep = comparisonStep
        this.relative_baseline = relative_baseline
        this.isNoZero = isNoZero
        this.normal = []
        this.absolute = []
        this.relative_normal = []
        this.relative_normal_baseline_positive = []
        this.relative_normal_baseline_negative = []
        this.relative_abs = []
        this.relative_abs_baseline = []
        this.normal_mean_square_error = 0
        this.normal_mean_error = 0
        this.absolute_mean_square_error = 0
        this.absolute_mean_error = 0
        this.relative_normal_mean_square_error = 0
        this.relative_normal_mean_error = 0
        this.relative_abs_mean_square_error = 0
        this.relative_abs_mean_error = 0
        if(!this.isNoZero){
            this.data1 = this.file1.rangeData
            this.data2 = this.file2.rangeData
        } else {
            this.data1 = this.file1.rangeDataNoZero
            this.data2 = this.file2.rangeDataNoZero
        }

        this.processData()
    }

    processData() {
        this.normal = [];
        this.absolute = [];
        this.relative_normal = [];
        this.relative_normal_baseline_positive = [];
        this.relative_normal_baseline_negative = [];
        this.relative_abs = [];
        this.relative_abs_baseline = [];

        let totalLength = Math.min(this.data1.length, this.data2.length);

        let i = 0;
        let x = 0;
        while (i < totalLength) {
            let tmp1, tmp2;
            if (i + this.comparisonStep <= totalLength) {
                tmp1 = this.data1.slice(i, i + this.comparisonStep).reduce((sum, n) => sum + n, 0) / this.comparisonStep;
                tmp2 = this.data2.slice(i, i + this.comparisonStep).reduce((sum, n) => sum + n, 0) / this.comparisonStep;
            } else {
                tmp1 = this.data1.slice(i, totalLength).reduce((sum, n) => sum + n, 0) / (totalLength - i);
                tmp2 = this.data2.slice(i, totalLength).reduce((sum, n) => sum + n, 0) / (totalLength - i);
            }

            this.normal.push({x: x * this.comparisonStep, y: tmp1 - tmp2});
            this.absolute.push({x: x * this.comparisonStep, y: Math.abs(tmp1 - tmp2)});
            this.relative_normal.push({x: x * this.comparisonStep, y: (tmp1 - tmp2) / tmp1});
            this.relative_normal_baseline_positive.push({x: x * this.comparisonStep, y: this.relative_baseline});
            this.relative_normal_baseline_negative.push({x: x * this.comparisonStep, y: -this.relative_baseline});
            this.relative_abs.push({x: x * this.comparisonStep, y: Math.abs(tmp1 - tmp2) / tmp1});
            this.relative_abs_baseline.push({x: x * this.comparisonStep, y: this.relative_baseline})

            i += this.comparisonStep;
            x++;
        }

        let errors = getMeanError(this.normal)
        this.normal_mean_error = errors[0];
        this.normal_mean_square_error = errors[1];

        errors = getMeanError(this.absolute)
        this.absolute_mean_error = errors[0];
        this.absolute_mean_square_error = errors[1];

        errors = getMeanError(this.relative_normal)
        this.relative_normal_mean_error = errors[0];
        this.relative_normal_mean_square_error = errors[1];

        errors = getMeanError(this.relative_abs)
        this.relative_abs_mean_error = errors[0];
        this.relative_abs_mean_square_error = errors[1];
    }

    getDataByComparisonType(comparisonType){
        if(comparisonType === 'normal'){
            return this.normal;
        }else if(comparisonType === 'absolute'){
            return this.absolute;
        }else if(comparisonType === 'relative_normal'){
            return this.relative_normal;
        }else if(comparisonType === 'relative_abs'){
            return this.relative_abs;
        }else{
            console.log('Unknown comparison type.')
        }
    }

    getMeanErrorByComparisonType(comparisonType){
        if(comparisonType === 'normal'){
            return [this.normal_mean_error, this.normal_mean_square_error];
        }else if(comparisonType === 'absolute'){
            return [this.absolute_mean_error, this.absolute_mean_square_error];
        }else if(comparisonType === 'relative_normal'){
            return [this.relative_normal_mean_error, this.relative_normal_mean_square_error];
        }else if(comparisonType === 'relative_abs'){
            return [this.relative_abs_mean_error, this.relative_abs_mean_square_error];
        }else{
            console.log('Unknown comparison type.')
        }
    }

    getMeanErrorInfo(comparisonType){
        let errors = this.getMeanErrorByComparisonType(comparisonType)
        return `Mean Error:${errors[0]}, Mean Square Error:${errors[1]}`
    }
}