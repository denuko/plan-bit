'use strict';
var http = require('http');
var express = require('express');
var Session = require('express-session');
var request = require('request');
var config = require('./config.json');
var randomstring = require('randomstring');
const fetch = require("node-fetch");
const localStorage = require('localStorage')

// Circuit REST API is in beta and only available on the sandbox at this time
const CircuitDomain = 'https://' + config.circuit.domain;

// Domain and port this app is running at
const AppDomain = config.app.host;
const AppPort = config.app.port;

// OAuth2 configuration
const ClientId = config.circuit.client_id;
const ClientSecret = config.circuit.client_secret;
const RedirectUri = `${AppDomain}:${AppPort}/oauthCallback`;
const Scopes = 'ALL';

let convId = 'bc0c35cb-3170-4330-9ab2-a3cfd6d57cf0';
let msgId = '72d80e2d-6978-4802-9091-f0abd1936b13';
let token;
//let formId = `event-${parentItemId}`;
let formId = 'event-accept-decline';

var app = express();
app.use(Session({
    secret: 'secret-6525474832',
    resave: true,
    saveUninitialized: true
}));

function auth(req, res, next) {
    req.session.isAuthenticated ? next() : res.redirect('/');
}

app.get('/profile', auth, (req, res) => {
    request.get(`${CircuitDomain}/rest/v2/users/profile`, {
        'auth': {'bearer': token}
    }, (err, httpResponse, body) => res.send(body));
});

app.get('/conversations', auth, (req, res) => {
    request.get(`${CircuitDomain}/rest/v2/conversations`, {
        'auth': {'bearer': token}
    }, (err, httpResponse, body) => res.send(body));
});

app.get('/logout', (req, res) => {
    req.session.isAuthenticated = false;
    token = null;
    res.redirect('/');
});
let userId = '9140dd00-98c5-4270-a7e5-b7ee9f3bdbeb';

app.post('/webhook', (req, res) => {
    const item = req.body && req.body.item;
    if (item && item.convId === convId) {
        console.log(item);
    } else {
        console.log('FAIL');

    }
    
    //FIX: Get form submit data
//    switch (req.body.type) {
//        case 'CONVERSATION.ADD_ITEM':
//            break;
//        case 'USER.SUBMIT_FORM_DATA':

//    debugger;
//    const {formId, itemId, submitterId, data} = req.body.submitFormData;
//    console.log(data);
//
//    console.log('WEBHOOK');

//    let formId = `event-${msgId}`;
//    if (formId !== `event-${msgId}`) {
//        res.status(500).send('Incorrect form');
//        return;
//    }

//    console.log(`Form submission by ${submitterId} on item ${itemId}`);
//    console.log(data);

    if (!checkIfUserAttendsEvent(msgId, userId)) {
        let attendees = getEventAttendees(msgId);
        attendees.push(userId);
        localStorage.setItem(`event${msgId}`, JSON.stringify(attendees));
    }

    console.log(localStorage.getItem(`event${msgId}`));

    console.log(`postNewQuestion, convId=${convId}, parentItemId=${msgId}`);

    let content = `Event invitation: <b>8/12 at 18:40.</b><br>`;
    let form = {
        id: formId,
        controls: [
            {
                type: 'LABEL',
                text: `<b>Invitation accepted</b>`
            }
        ]
    };

    let url = `${CircuitDomain}/rest/conversations/${convId}/messages/${msgId}`;
    fetch(url, {
        method: 'PUT',
        headers: {'Authorization': 'Bearer ' + token},
        body: JSON.stringify({
            content: content,
            formMetaData: JSON.stringify(form)
        })
    })
            .then(response => response.json())
            .then(json => {
                console.log(json);
                setTimeout(function () {
                    loginBot();
                }, 40000);
            });
});
app.use('/oauthCallback', (req, res) => {
    if (req.query.code && req.session.oauthState === req.query.state) {
        request.post({
            url: `${CircuitDomain}/oauth/token`,
            form: {
                client_id: ClientId,
                client_secret: ClientSecret,
                redirect_uri: RedirectUri,
                grant_type: 'authorization_code',
                code: req.query.code
            }
        }, (err, httpResponse, body) => {
            if (!err && body) {
                token = JSON.parse(body).access_token;
                req.session.isAuthenticated = true;
                res.redirect('/');
            } else {
                res.send(401);
            }
        });
    } else {
        // Access denied
        res.redirect('/');
    }
});

app.get('/', (req, res) => {
    if (req.session.isAuthenticated) {
        fetch(`${CircuitDomain}/rest/webhooks`, {
            method: 'DELETE',
            headers: {'Authorization': 'Bearer ' + token}
        }).then(() => {
            fetch(`${CircuitDomain}/rest/webhooks`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                body: `url=${encodeURI(`http://7e42a028.ngrok.io/webhook`)}&filter=USER.SUBMIT_FORM_DATA`
            })
                    .then(response => response.json())
                    .then(data => {
//                        console.log(data);
                        postNewQuestion(convId, msgId, token);
                    })
                    .catch(error => console.error('Error:', error));


            fetch(`${CircuitDomain}/rest/webhooks`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                body: `url=${encodeURI(`http://7e42a028.ngrok.io/webhook`)}&filter=CONVERSATION.ADD_ITEM`
            })
                    .then(response => response.json())
                    .then(data => {
                        console.log(data);
                    })
                    .catch(error => console.error('Error:', error));
        });
    } else {
        let redirectUri = encodeURIComponent(RedirectUri);
        let state = randomstring.generate(12);
        let url = `${CircuitDomain}/oauth/authorize?scope=${Scopes}&state=${state}&redirect_uri=${redirectUri}&response_type=code&client_id=${ClientId}`;
        // Save state in session and check later to prevent CSRF attacks
        req.session.oauthState = state;
        res.send(`<a href=${url}>Login to Circuit</a>`);
    }
});

var server = http.createServer(app);
server.listen(AppPort);
server.on('listening', () => console.log(`listening on ${AppPort}`));

/**
 * Post a new question
 * @param {String} convId Conversation ID
 * @param {String} parentItemId Parent Item ID
 * @param {String} agentParams DialogFlow agent response parameters
 */
async function postNewQuestion(convId, parentItemId, token) {
    console.log(`postNewQuestion, convId=${convId}, parentItemId=${parentItemId}`);

    let content = `Event invitation: <b>8/12 at 18:40.</b><br>`;
    let form = {
        id: formId,
        controls: [
            {
                type: 'LABEL',
                text: `<b>Options</b>`
            }, {
                name: 'choices',
                type: 'RADIO',
                options: [{
                        text: "Accept",
                        value: "accept"
                    }, {
                        text: "Decline",
                        value: "decline"
                    }]
            },
            {
                type: 'BUTTON',
                options: [{
                        text: 'Submit',
                        action: 'submit',
                        notification: 'Answer submitted'
                    }]
            }]
    };

    let url = `${CircuitDomain}/rest/conversations/${convId}/messages/${parentItemId}`;
    fetch(url, {
        method: 'PUT',
        headers: {'Authorization': 'Bearer ' + token},
        body: JSON.stringify({
            content: content,
            formMetaData: JSON.stringify(form)
        })
    })
            .then(response => response.json())
            .then(json => {
                console.log(json);
            })
            .catch(error => {
                console.log(error);
            });
}

function checkIfUserAttendsEvent(msgId, userId) {
    let attendees = getEventAttendees(msgId);

    return attendees.includes(userId);
}

function getEventAttendees(msgId) {
    let attendees = JSON.parse(localStorage.getItem(`event${msgId}`));
    if (attendees == null) {
        attendees = [];
    }

    return attendees;
}

function getEventAttendeesCount(msgId) {
    let attendees = getEventAttendees(msgId);

    return attendees.length;
}

function loginBot() {
    request.post({
        url: `${CircuitDomain}/oauth/token`,
        form: {
            client_id: config.circuit_bot.client_id,
            client_secret: config.circuit_bot.client_secret,
            domains: RedirectUri,
            grant_type: 'client_credentials',
            scopes: 'ALL'
        }
    }, (err, httpResponse, body) => {
        if (!err && body) {
            let botToken = JSON.parse(body).access_token;
            postUpcomingEventNotification(botToken);
        } else {
            res.send(401);
        }
    });
}

function postUpcomingEventNotification(botToken) {
    let url = `${CircuitDomain}/rest/conversations/${convId}/messages/${msgId}`;

    let attendeesCount = getEventAttendeesCount(msgId);

    let content = '*Challenge The Force Within Her PARTY* starts in 30 minutes.<br>';
    content += `${attendeesCount} of 5 close colleagues will attend.<br>`;

    fetch(url, {
        method: 'POST',
        headers: {'Authorization': 'Bearer ' + botToken},
        body:
                JSON.stringify({
                    content: content
                })
    })
            .then(response => response.json())
            .then(json => {
                console.log(json);
            })
            .catch(error => {
                console.log(error);
            });
}