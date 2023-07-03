import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import qs from 'qs';
import ExcelJS from 'exceljs';

dotenv.config();

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

async function getToken(username: string, password: string) {
    const url = `${process.env.URL_REALMS}auth/realms/seachange/protocol/openid-connect/token`

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

app.get('/api/user-ip', async (req, res) => {
    try {
        const username = req.body.username;
        const password = req.body.password;

        const token = await getToken(username, password);

        const usersResponse = await axios.get(`${process.env.BASE_URL}/accounts/private/accounts/search?size=1000`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        let workbook = new ExcelJS.Workbook();
        let worksheet = workbook.addWorksheet('Users');
        worksheet.columns = [
            { header: 'ID', key: 'id' },
            { header: 'Nome', key: 'name' },
            { header: 'Email', key: 'email' },
            { header: 'Status', key: 'status' },
            { header: 'IP', key: 'ip' }
        ];

        console.time('Processing time');

        for (let user of usersResponse.data.content) {
            const ipResponse = await axios.get(`${process.env.BASE_URL}/audit/events/private/user/360-audit-events?accountId=${user.id}&page=1&size=50&sort=timestamp%2Cdesc`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            let activeUser = false;
            let userStatus = null;
            let ip = null;
            if (ipResponse.data && ipResponse.data.content) {
                for (let event of ipResponse.data.content) {
                    if (event.data && event.data.userSubscription && event.data.userSubscription.status === 'active' && event.initiator === 'user' && event.ip) {
                        activeUser = true;
                        userStatus = 'active';
                        ip = event.ip;
                        console.log(`O usuário ${user.id} está ativo.`);
                        break;
                    }
                }
            }

            if (activeUser) {
                let userRow = {
                    id: user.id,
                    name: user.firstName + ' ' + user.surname,
                    email: user.email,
                    status: userStatus,
                    ip: ip
                };
                console.log(`O usuário ${user.id} está ativo.`);
                console.log(userRow);
                worksheet.addRow(userRow);
            } else {
                console.log(`O usuário ${user.id}  não está ativo.`);
            }
        }
        console.timeEnd('Processing time');
        workbook.xlsx.writeFile('users.xlsx')
            .then(() => res.send('Arquivo Excel criado com sucesso.'))
            .catch(err => {
                let error = err as Error;
                res.status(500).send(error.toString());
            });
    } catch (err) {
        let error = err as Error;
        res.status(500).send(error.toString());
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
