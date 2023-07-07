import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import qs from 'qs';
import fs from 'fs';
import path from 'path';
import { Sequelize, DataTypes } from 'sequelize';
import { WebServiceClient } from '@maxmind/geoip2-node';

dotenv.config();

const client = new WebServiceClient(`${process.env.ACCOUNT_ID}`, `${process.env.LICENSE_KEY}`);

const sequelize = new Sequelize(`${process.env.POSTGRES_DATABASE}`, `${process.env.POSTGRES_USER}`, `${process.env.POSTGRES_PASSWORD}`, {
  host: `${process.env.POSTGRES_HOST}`,
  port: Number(process.env.POSTGRES_PORT),
  dialect: 'postgres',
});

const User_active = sequelize.define('User_active', {
  id: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  name: DataTypes.STRING,
  email: DataTypes.STRING,
  city: DataTypes.STRING,
  state: DataTypes.STRING,
  country: DataTypes.STRING,
  status: DataTypes.STRING,
  ip: DataTypes.STRING
}, {
});


const User_grace_period = sequelize.define('User_grace_period', {
  id: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  name: DataTypes.STRING,
  email: DataTypes.STRING,
  city: DataTypes.STRING,
  state: DataTypes.STRING,
  country: DataTypes.STRING,
  status: DataTypes.STRING,
  ip: DataTypes.STRING
}, {
});

sequelize.sync()
  .then(() => console.log('Conexão e sincronização com o banco de dados PostgreSQL realizadas com sucesso'))
  .catch(e => console.log('Falha na conexão ou sincronização com o PostgreSQL', e));

const Reader = require('@maxmind/geoip2-node').Reader;
const dbFilePath = path.resolve(__dirname, 'GeoIP2-City.mmdb');



const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

let token: string | null = null;
let tokenFetchTime: number | null = null;

async function getToken(username: string, password: string) {
  const url = `${process.env.URL_REALMS}auth/realms/seachange/protocol/openid-connect/token`;
  const data = qs.stringify({
    username,
    client_id: process.env.CLIENT_ID,
    grant_type: process.env.GRANT_TYPE,
    password
  });
  const config = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  const response = await axios.post(url, data, config);
  return response.data.access_token;
}

async function getValidToken(username: string, password: string) {
  if (token && tokenFetchTime && Date.now() - tokenFetchTime < 3 * 60 * 1000) {
    return token;
  }

  token = await getToken(username, password);
  tokenFetchTime = Date.now();
  return token;
}

app.get('/api/user-active', async (req, res) => {
  var isProcessing = false;
  if (isProcessing) {
    res.status(503).send('O processo ainda está em execução');
    return;
  }

  isProcessing = true;


  const username = req.body.username;
  const password = req.body.password;

  let page = 0;

  try {
    const data = fs.readFileSync('last_page_processed_active.log', 'utf8');
    const match = data.match(/Last page processed active: (\d+)/);
    if (match) {
      page = Number(match[1]);
    }
  } catch (err) {
    console.log('No previous page found. Starting from page 1.');
  }


  try {
    let token = await getValidToken(username, password);

    const body = {
      userSubscriptionStatus: "active",
      accountId: null
    };

    let totalElements;

    do {
      page++;

      console.time('Processing time,process.env.BASE_URL');
      const usersResponse = await axios.post(`${process.env.BASE_URL}/shop/subscriptions/private/user/account-subscriptions?page=${page}&sort=userSubscriptionStatus,desc&size=100`, body, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      totalElements = usersResponse.data.totalElements;

      console.log(`Page ${page} of ${Math.ceil(totalElements / 100)}`);
      console.log(`Total elements: ${totalElements}`);


      for (let user of usersResponse.data.content) {
        token = await getValidToken(username, password);
 

        let ipResponse;
        let page = 1;
        let size = 200;

        while (true) {
          ipResponse = await axios.get(`${process.env.BASE_URL}audit/events/private/user/360-audit-events?accountId=${user.accountId}&page=${page}&size=${size}&sort=timestamp%2Cdesc`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          let foundUserEvent = false;

          if (ipResponse.data && ipResponse.data.content) {
            for (let event of ipResponse.data.content) {
              if (event.data && event.ip && event.initiator === 'user') {
                foundUserEvent = true;
                break;
              }
            }
          }

          if (foundUserEvent || ipResponse.data.content.length < size) {
            break;
          }

          page++;
        }
 
        const userResponse = await axios.get(`${process.env.BASE_URL}zuul/accounts/private/accounts/search?size=100&query=${user.accountId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        let activeUser = false;
        let userStatus = null;
        let ip = null as any;
        let ipSystem = null as any;
        let systemEvent = null as any;

        if (ipResponse.data && ipResponse.data.content) {
          for (let event of ipResponse.data.content) {
            if (event.data && event.ip) {
              if (event.initiator === 'user') {
                activeUser = true;
                userStatus = 'active';
                ip = event.ip;
                break;
              } else if (event.initiator === 'system') {
                systemEvent = event;
              }
            }
          }
        }

        if (!activeUser && systemEvent) {
          activeUser = true;
          userStatus = 'active';
          ipSystem = systemEvent.ip;
        }

        if (activeUser) {
          const reader = await Reader.open(dbFilePath);
          try {
            const responseGeo = await reader.city(ip || ipSystem);
            let userRow = {
              id: user.accountId,
              name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
              email: userResponse.data.content[0].email,
              status: user.userSubscriptionStatus,
              city: responseGeo.city.names.en,
              state: responseGeo.subdivisions[0].names.en,
              country: responseGeo.country.names.en,
              ip: ip || ipSystem
            };

            try {
              console.log(`User ${userRow.id} - ${userRow.name} has been added to the database.`);
              await User_active.create(userRow);
            } catch (error: any) {
              console.error(`Error occurred while saving to the database: ${error.message} responseGeo`);
            }
          } catch (error: any) {

            try {
              const responseWebServiceClient = await client.city(ip || ipSystem) as any;
              console.dir(responseWebServiceClient, { depth: null });

              let userRow = {
                id: user.accountId,
                name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                email: userResponse.data.content[0].email,
                status: user.userSubscriptionStatus,
                city: responseWebServiceClient.city.names.en,
                state: responseWebServiceClient.subdivisions[0].names.en,
                country: responseWebServiceClient.country.names.en,
                ip: ip || ipSystem
              };



              try {
                await User_active.create(userRow);
              } catch (error: any) {
                console.error(`Error occurred while saving to the database: ${error.message} responseGeo`);
              }

            } catch (error: any) {


              let userRow = {
                id: user.accountId,
                name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                email: userResponse.data.content[0].email,
                status:  user.userSubscriptionStatus,
                city: '',
                state: '',
                country: '',
                ip: ip || ipSystem
              };

              try {
                await User_active.create(userRow);
                console.log(`User ${userRow.id} - ${userRow.name} has been added to the database. responseWebServiceClient`);
              } catch (error: any) {
                console.error(`Error occurred while saving to the database: ${error.message} responseWebServiceClient`);
              }
            }
          }
        }
      }

      console.timeEnd('Processing time');

      if (!fs.existsSync(path.resolve(__dirname, 'files'))) {
        fs.mkdirSync(path.resolve(__dirname, 'files'));
      }

      fs.writeFileSync('last_page_processed_active.log', `Last page processed active: ${page}`);
    } while (page * 100 < totalElements);

    res.send('Todos os arquivos Excel criados com sucesso.');
  } catch (err) {
    process.kill(process.pid, 'SIGINT');
    process.exit(1)
  }

  isProcessing = false;

});







app.get('/api/user-grace-period', async (req, res) => {
  var isProcessing = false;
  if (isProcessing) {
    res.status(503).send('O processo ainda está em execução');
    return;
  }

  isProcessing = true;


  const username = req.body.username;
  const password = req.body.password;

  let page = 0;

  try {
    const data = fs.readFileSync('last_page_processed_user_grace_period.log', 'utf8');
    const match = data.match(/Last page processed grace period: (\d+)/);
    if (match) {
      page = Number(match[1]);
    }
  } catch (err) {
    console.log('No previous page found. Starting from page 1.');
  }


  try {
    let token = await getValidToken(username, password);

    const body = {
      userSubscriptionStatus: "grace_period",
      accountId: null
    };

    let totalElements;

    do {
      page++;

      console.time('Processing time,process.env.BASE_URL');
      const usersResponse = await axios.post(`${process.env.BASE_URL}/shop/subscriptions/private/user/account-subscriptions?page=${page}&sort=userSubscriptionStatus,desc&size=100`, body, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      totalElements = usersResponse.data.totalElements;

      console.log(`Page ${page} of ${Math.ceil(totalElements / 100)}`);
      console.log(`Total elements: ${totalElements}`);


      for (let user of usersResponse.data.content) {
        token = await getValidToken(username, password);
 

        let ipResponse;
        let page = 1;
        let size = 200;

        while (true) {
          ipResponse = await axios.get(`${process.env.BASE_URL}audit/events/private/user/360-audit-events?accountId=${user.accountId}&page=${page}&size=${size}&sort=timestamp%2Cdesc`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          let foundUserEvent = false;

          if (ipResponse.data && ipResponse.data.content) {
            for (let event of ipResponse.data.content) {
              if (event.data && event.ip && event.initiator === 'user') {
                foundUserEvent = true;
                break;
              }
            }
          }

          if (foundUserEvent || ipResponse.data.content.length < size) {
            break;
          }

          page++;
        }
 
        const userResponse = await axios.get(`${process.env.BASE_URL}zuul/accounts/private/accounts/search?size=100&query=${user.accountId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        let gracePeriodUser = false;
        let userStatus = null;
        let ip = null as any;
        let ipSystem = null as any;
        let systemEvent = null as any;

        if (ipResponse.data && ipResponse.data.content) {
          for (let event of ipResponse.data.content) {
            if (event.data && event.ip) {
              if (event.initiator === 'user') {
                gracePeriodUser = true;
                userStatus = 'grace_period';
                ip = event.ip;
                break;
              } else if (event.initiator === 'system') {
                systemEvent = event;
              }
            }
          }
        }

        if (!gracePeriodUser && systemEvent) {
          gracePeriodUser = true;
          userStatus = 'grace_period';
          ipSystem = systemEvent.ip;
        }

        if (gracePeriodUser) {
          const reader = await Reader.open(dbFilePath);
          try {
            const responseGeo = await reader.city(ip || ipSystem);
            let userRow = {
              id: user.accountId,
              name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
              email: userResponse.data.content[0].email,
              status: user.userSubscriptionStatus,
              city: responseGeo.city.names.en,
              state: responseGeo.subdivisions[0].names.en,
              country: responseGeo.country.names.en,
              ip: ip || ipSystem
            };

            try {
              console.log(`User ${userRow.id} - ${userRow.name} has been added to the database.`);
              await User_grace_period.create(userRow);
            } catch (error: any) {
              console.error(`Error occurred while saving to the database: ${error.message} responseGeo`);
            }
          } catch (error: any) {

            try {
              const responseWebServiceClient = await client.city(ip || ipSystem) as any;
              console.dir(responseWebServiceClient, { depth: null });

              let userRow = {
                id: user.accountId,
                name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                email: userResponse.data.content[0].email,
                status: user.userSubscriptionStatus,
                city: responseWebServiceClient.city.names.en,
                state: responseWebServiceClient.subdivisions[0].names.en,
                country: responseWebServiceClient.country.names.en,
                ip: ip || ipSystem
              };



              try {
                await User_grace_period.create(userRow);
              } catch (error: any) {
                console.error(`Error occurred while saving to the database: ${error.message} responseGeo`);
              }

            } catch (error: any) {


              let userRow = {
                id: user.accountId,
                name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                email: userResponse.data.content[0].email,
                status: user.userSubscriptionStatus,
                city: '',
                state: '',
                country: '',
                ip: ip || ipSystem
              };

              try {
                await User_grace_period.create(userRow);
                console.log(`User ${userRow.id} - ${userRow.name} has been added to the database. responseWebServiceClient`);
              } catch (error: any) {
                console.error(`Error occurred while saving to the database: ${error.message} responseWebServiceClient`);
              }
            }
          }
        }
      }

      console.timeEnd('Processing time');

      if (!fs.existsSync(path.resolve(__dirname, 'files'))) {
        fs.mkdirSync(path.resolve(__dirname, 'files'));
      }

      fs.writeFileSync('last_page_processed_user_grace_period.log', `Last page processed grace period: ${page}`);
    } while (page * 100 < totalElements);

    res.send('Todos os arquivos Excel criados com sucesso.');
  } catch (err) {
    process.kill(process.pid, 'SIGINT');
    process.exit(1)
  }

  isProcessing = false;

});


process.on('uncaughtException', (error) => {
  console.error('Erro não tratado:', error);
  process.kill(process.pid, 'SIGINT');
  process.exit(1);
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
