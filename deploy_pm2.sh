#!/bin/bash
NAME=""
FOLDER="/home/pi/$NAME"
pm2 start -n $NAME --watch $FOLDER/dist -l $FOLDER/logs/log.out -o $FOLDER/logs/output.log -e $FOLDER/logs/error.log $FOLDER/dist/index.js