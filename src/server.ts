import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import qs from 'qs';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const Reader = require('@maxmind/geoip2-node').Reader;
const dbFilePath = path.resolve(__dirname, 'GeoIP2-City.mmdb');
const options = {
  // you can use options like `cache` or `watchForUpdates`
};

dotenv.config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

let token: string | null = null;
let tokenFetchTime: number | null = null;

async function getToken(username: string, password: string) {
  const url = `${process.env.URL_REALMS}auth/realms/seachange/protocol/openid-connect/token`;
  console.log(`Getting token from ${url}`);
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

app.get('/api/user-ip', async (req, res) => {
  var isProcessing: any
  if (isProcessing) {
    res.status(503).send('O processo ainda está em execução');
    return;
  }
  
    isProcessing = true;


  const username = req.body.username;
  const password = req.body.password;

  let page = 0;

  try {
    const data = fs.readFileSync('last_page_processed.log', 'utf8');
    const match = data.match(/Last page processed: (\d+)/);
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
    const usersResponse = await axios.post(`${process.env.BASE_URL}/shop/subscriptions/private/user/account-subscriptions?page=${page}&sort=userSubscriptionStatus,desc&size=1000`, body, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    totalElements = usersResponse.data.totalElements;

    console.log(`Page ${page} of ${Math.ceil(totalElements / 1000)}`);
    console.log(`Total elements: ${totalElements}`);

    let workbook = new ExcelJS.Workbook();
    let worksheet = workbook.addWorksheet('Users');
    worksheet.columns = [
      { header: 'ID', key: 'id' },
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Postal Code', key: 'postalCode' },
      { header: 'City', key: 'city' },
      { header: 'Country', key: 'country' },
      { header: 'Status', key: 'status' },
      { header: 'IP (User)', key: 'ipUser' },
      { header: 'IP (System)', key: 'ipSystem' }
    ];

    console.time('Processing time');

    for (let user of usersResponse.data.content) {
      token = await getValidToken(username, password);

      const ipResponse = await axios.get(`${process.env.BASE_URL}/audit/events/private/user/360-audit-events?accountId=${user.accountId}&page=1&size=200&sort=timestamp%2Cdesc`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const userResponse = await axios.get(`${process.env.BASE_URL}/accounts/private/accounts/search?size=100&query=${user.accountId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      let activeUser = false;
      let userStatus = null;
      let ipUser = null as any;
      let ipSystem = null as any;
      let systemEvent = null;

      if (ipResponse.data && ipResponse.data.content) {
        for (let event of ipResponse.data.content) {
          if (event.data && event.ip) {
            if (event.initiator === 'user') {
              activeUser = true;
              userStatus = 'active';
              ipUser = event.ip;
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
          const responseGeo = await reader.city(ipUser || ipSystem);

          console.log(responseGeo);
          let userRow = {
            id: user.accountId,
            name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
            email: userResponse.data.content[0].email,
            status: userStatus || 'inactive',
            postalCode: '',
            city: '',
            country: '',
            ipUser: ipUser,
            ipSystem: ipSystem
          };

          if (responseGeo && responseGeo.country && responseGeo.city && responseGeo.postal) {
            userRow.postalCode = responseGeo.postal.code;
            userRow.city = responseGeo.city.names.en;
            userRow.country = responseGeo.country.names.en;
          }

          console.log(`User ${userRow.id} - ${userRow.name} - ${userRow.email} - ${userRow.postalCode} - ${userRow.city} - ${userRow.country} - ${userRow.status} - IP user ${userRow.ipUser} - IP System ${userRow.ipSystem}`);
          worksheet.addRow(userRow);
        } catch (error: any) {
          console.log(`Error occurred while retrieving geo information: ${error.message}`);
          let userRow = {
            id: user.accountId,
            name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
            email: userResponse.data.content[0].email,
            status: userStatus || 'inactive',
            postalCode: '',
            city: '',
            country: '',
            ipUser: ipUser,
            ipSystem: ipSystem
          };
          console.log(`User ${userRow.id} - ${userRow.name} - ${userRow.email} - ${userRow.status} - IP user ${userRow.ipUser} - IP System ${userRow.ipSystem}`);
          worksheet.addRow(userRow);
        }
      }
    }

    console.timeEnd('Processing time');
    await workbook.xlsx.writeFile(`users_page_${page}.xlsx`);
    fs.writeFileSync('last_page_processed.log', `Last page processed: ${page}`);
  } while (page * 100 < totalElements);

  res.send('Todos os arquivos Excel criados com sucesso.');
} catch (err: any) {
  console.log(`Error occurred: ${err.message}`); 
}

isProcessing = false;

});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
