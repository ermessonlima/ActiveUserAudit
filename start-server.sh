#!/bin/bash

 

##### bash chmod +x start-server.sh
##### ./start-server.sh



npm run watch &

 
sleep 5

 
npm run compile
 
pm2 start ecosystem.config.js
 


