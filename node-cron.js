require('dotenv').config();
const cron = require('node-cron');
const request = require('request');

const url = 'http://localhost:3000/api/user-active';
const data = {
  username: process.env.USERNAME,
  password: process.env.PASSWORD
};

console.log('Cron job started', data);

const taskFunction = () => {
  request.get({
    url: url,
    body: data,
    json: true,
    timeout: 36000000  
  }, function(error, response, body) {
    if (error) {
      console.log('Request error:', error.message);
    } else {
      console.log('Request success:', body);
    }
  });
};
 
taskFunction();
 
const task = cron.schedule('*/10 * * * *', taskFunction);

task.start();

process.on('uncaughtException', error => {
  console.error('Uncaught Exception:', error); 
});
