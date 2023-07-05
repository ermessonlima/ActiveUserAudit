"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const qs_1 = __importDefault(require("qs"));
const exceljs_1 = __importDefault(require("exceljs"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Reader = require('@maxmind/geoip2-node').Reader;
const dbFilePath = path_1.default.resolve(__dirname, 'GeoIP2-City.mmdb');
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const port = process.env.PORT || 3000;
let token = null;
let tokenFetchTime = null;
function getToken(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${process.env.URL_REALMS}auth/realms/seachange/protocol/openid-connect/token`;
        console.log(`Getting token from ${url}`);
        const data = qs_1.default.stringify({
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
        const response = yield axios_1.default.post(url, data, config);
        return response.data.access_token;
    });
}
function getValidToken(username, password) {
    return __awaiter(this, void 0, void 0, function* () {
        if (token && tokenFetchTime && Date.now() - tokenFetchTime < 3 * 60 * 1000) {
            return token;
        }
        token = yield getToken(username, password);
        tokenFetchTime = Date.now();
        return token;
    });
}
app.get('/api/user-ip', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var isProcessing;
    if (isProcessing) {
        res.status(503).send('O processo ainda está em execução');
        return;
    }
    isProcessing = true;
    const username = req.body.username;
    const password = req.body.password;
    let page = 0;
    try {
        const data = fs_1.default.readFileSync('last_page_processed.log', 'utf8');
        const match = data.match(/Last page processed: (\d+)/);
        if (match) {
            page = Number(match[1]);
        }
    }
    catch (err) {
        console.log('No previous page found. Starting from page 1.');
    }
    try {
        let token = yield getValidToken(username, password);
        const body = {
            userSubscriptionStatus: "active",
            accountId: null
        };
        let totalElements;
        do {
            page++;
            const usersResponse = yield axios_1.default.post(`${process.env.BASE_URL}/shop/subscriptions/private/user/account-subscriptions?page=${page}&sort=userSubscriptionStatus,desc&size=50`, body, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            totalElements = usersResponse.data.totalElements;
            console.log(`Page ${page} of ${Math.ceil(totalElements / 1000)}`);
            console.log(`Total elements: ${totalElements}`);
            let workbook = new exceljs_1.default.Workbook();
            let worksheet = workbook.addWorksheet('Users');
            worksheet.columns = [
                { header: 'ID', key: 'id' },
                { header: 'Name', key: 'name' },
                { header: 'Email', key: 'email' },
                { header: 'Postal Code', key: 'postalCode' },
                { header: 'City', key: 'city' },
                { header: 'State', key: 'state' },
                { header: 'Country', key: 'country' },
                { header: 'Status', key: 'status' },
                { header: 'IP (User)', key: 'ipUser' },
                { header: 'IP (System)', key: 'ipSystem' }
            ];
            console.time('Processing time');
            for (let user of usersResponse.data.content) {
                token = yield getValidToken(username, password);
                const ipResponse = yield axios_1.default.get(`${process.env.BASE_URL}/audit/events/private/user/360-audit-events?accountId=${user.accountId}&page=1&size=200&sort=timestamp%2Cdesc`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const userResponse = yield axios_1.default.get(`https://univer-prod.cloud.seachange.com/zuul/accounts/private/accounts/search?size=100&query=${user.accountId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                let activeUser = false;
                let userStatus = null;
                let ipUser = null;
                let ipSystem = null;
                let systemEvent = null;
                if (ipResponse.data && ipResponse.data.content) {
                    for (let event of ipResponse.data.content) {
                        if (event.data && event.ip) {
                            if (event.initiator === 'user') {
                                activeUser = true;
                                userStatus = 'active';
                                ipUser = event.ip;
                                break;
                            }
                            else if (event.initiator === 'system') {
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
                    const reader = yield Reader.open(dbFilePath);
                    try {
                        const responseGeo = yield reader.city(ipUser || ipSystem);
                        console.dir(responseGeo, { depth: null });
                        let userRow = {
                            id: user.accountId,
                            name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                            email: userResponse.data.content[0].email,
                            status: userStatus || 'inactive',
                            postalCode: '',
                            city: '',
                            state: '',
                            country: '',
                            ipUser: ipUser,
                            ipSystem: ipSystem
                        };
                        if (responseGeo && responseGeo.country && responseGeo.city && responseGeo.postal) {
                            userRow.postalCode = responseGeo.postal.code;
                            userRow.city = responseGeo.city.names['pt-BR'];
                            userRow.state = responseGeo.subdivisions[0].names['pt-BR'];
                            userRow.country = responseGeo.country.names['pt-BR'];
                        }
                        console.log(`User ${userRow.id} - ${userRow.name} - ${userRow.email} - ${userRow.postalCode} - ${userRow.city} - ${userRow.state} - ${userRow.country} - ${userRow.status} - IP user ${userRow.ipUser} - IP System ${userRow.ipSystem}`);
                        worksheet.addRow(userRow);
                    }
                    catch (error) {
                        console.log(`Error occurred while retrieving geo information: ${error.message}`);
                        let userRow = {
                            id: user.accountId,
                            name: userResponse.data.content[0].firstName + ' ' + userResponse.data.content[0].surname,
                            email: userResponse.data.content[0].email,
                            status: userStatus || 'inactive',
                            postalCode: '',
                            city: '',
                            state: '',
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
            if (!fs_1.default.existsSync(path_1.default.resolve(__dirname, 'files'))) {
                fs_1.default.mkdirSync(path_1.default.resolve(__dirname, 'files'));
            }
            yield workbook.xlsx.writeFile(path_1.default.resolve(__dirname, './files/', `users_page_${page}.xlsx`));
            fs_1.default.writeFileSync('last_page_processed.log', `Last page processed: ${page}`);
        } while (page * 100 < totalElements);
        res.send('Todos os arquivos Excel criados com sucesso.');
    }
    catch (err) {
        process.kill(process.pid, 'SIGINT');
        process.exit(1);
    }
    isProcessing = false;
}));
process.on('uncaughtException', (error) => {
    process.kill(process.pid, 'SIGINT');
    console.error('Erro não tratado:', error);
    process.exit(1);
});
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
