# TrainingLogParser


## 1. Project Introduction

Parse model training logs in a visualized manner to visualize the model training process. The project is written by html + css + js **static web page** (all operations processing in the front end), the chart uses canvasjs.

welcome to contribute code.

## 2. Project Advantages

Compared with TensorBoard, TensorBoard needs to add related code to the model. This tool parses the final training logs and does not need to modify any model code.

## 3. Quick Start

Just open [web](https://curryrice233.github.io/TrainingLogParser/), drag into your training log!

## 4. Content Introduction

### Loss Chart

 - After the training log file is dragged, the corresponding log file is displayed in the Log Parser area on the right. 
 
 - Select the log file and the corresponding loss curve chart will displayed. 
 
 - Click the gear icon to set the loss tag or obtain the loss value through regular expression matching. If the diagram looks strange, please check the loss tag or matching rule is correct.

### Comparison Chart

When the number of selected logs is 2, a comparison chart is displayed. In the Comparison Setting area on the right, you can set the content to be displayed in the comparison chart.

- Comparison Normal: Loss difference between two logs.
- Comparison Absolute: absolute loss difference between two logs.
- Comparison Relative: indicates the relative loss difference between two logs.
- Comparison step: indicates the number of comparison steps. The value of Comparison step is averaged.


## 5. How to give feedback

If you have any suggestions or questions, please open an Issue.

## 6. Update Log

v1.0.8
- Added the log deletion function.

v1.0.7
- Add average error and average variance.
- Fixed an issue where the Loss chart was also displayed when no file was selected.

v1.0.6
- Fixed multi-file standard line misalignment issue.

v1.0.5
- Add a standard line with a relative error of 2%.

v1.0.4
- Added overflow zero elimination.
- The number of steps in the comparison chart is changed to be aligned with the number of steps in the loss chart.

v1.0.3
- The maximum and minimum average values of loss are displayed in the upper left corner.
- Added the file setting window Loss parsing file download.

v1.0.2
- Increase loss averaging.
- Fixed the same file import problem.

v1.0.1
- Added support for regular expressions.
- Added cookies for loss tag storage, so that loss tag information is not lost after the web page is closed.

v1.0
- Parsing of multiple logs and drawing of their loss curves.
- By comparing the two logs, it is easier to see where the deviation begins.
