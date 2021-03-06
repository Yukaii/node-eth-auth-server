const express = require('express');
const path = require('path');
const util = require('util');
const session = require('express-session')
const bodyParser = require('body-parser')
const morgan = require('morgan')
const jwt = require('jsonwebtoken')
const EthAuth = require('node-eth-auth');
const async = require("async");
const MobileDetect = require('mobile-detect')

const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/config/config.json')[env];

const app = express();
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// LOG
if (app.get('env') === 'development')
  app.use(morgan('dev'))

// issue, dev // maybe add salt with secret
app.set('secret', config.secret)

// initalize database
const db = require('./models');
const User = db.User;
const Session = db.Session;

// creat database if not exist // if force == true : drop table
async function initalize(){
  await User.sync();
  await Session.sync({force: true});
};
initalize();

// initalize sequelize with session store
const SequelizeStore = require('connect-session-sequelize')(session.Store);

app.use(session({
  secret: app.get('secret'),
  store: new SequelizeStore({
    db: db.sequelize,
    table: 'Session'
  }),
  resave: false,
  saveUninitialized: true
}))

// Add body parser.
app.use(bodyParser.urlencoded({extended: false}))
app.use(bodyParser.json())

// ethAuth
const ethAuth1 = new EthAuth({banner: config.banner});
const ethAuth2 = new EthAuth({banner: config.banner, method: 'personal_sign'});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => { 
  if(req.session.address)
    res.render('logout', {address:req.session.address});
  else {
    md = new MobileDetect(req.headers['user-agent']);
    if (md.mobile()){
      console.log("mobilemobilemobilemobilemobile")
      res.render('index', {method:'personal_sign'})
    }
    else {
      res.render('index', {method:'eth_signTypedData'})
    }
  }
});

async function ethauthMiddleware(req, res, next) {
  var middleware = ethAuth1;
  md = new MobileDetect(req.headers['user-agent']);
  if (md.mobile())
    middleware = ethAuth2;

  async.series([middleware.bind(null, req, res)], function(err) {
    if(err) 
      return next(err);
    next();
  });
}

// return Address or Confirm Code or status 400
app.get('/auth/:Address', ethauthMiddleware, (req, res) => { 
  req.ethAuth.message ? res.send(req.ethAuth.message) : res.status(400).send();
});

// return Address or status 400
app.post('/auth/:Message/:Signature', ethauthMiddleware, (req, res) => { 
  const address = req.ethAuth.recoveredAddress;
  if (!address) 
    res.status(400).send();
  else {
    User.findOrCreate({ where: {"address": address} }).spread( (ethauth,created) => {
      const token = jwt.sign(ethauth.get({ plain: true }), app.get('secret'), {
        expiresIn: 60*15*1000 // session expire time deafault hardcode 15 min // SHOULD CONFIG
      })

      req.session.cookie.expires = 60*15*1000; // session expire time deafault hardcode 15 min // SHOULD CONFIG
      req.session.address_id = ethauth.dataValues.id; // database id // oauth use
      req.session.address = address;
      req.session.token = token;

      res.json({
        success: true,
        message: 'EthAuth Success',
        token: token
      })
    });
  }
});

function apiMiddleware(req, res, next) {
  const token = req.session.token;
  if (token) {
    // issue case: after server restart will pass verify cond,but token is expire, maybe should check database
    jwt.verify(token, app.get('secret'), function (err, decoded) {
      if (err) {
        return res.json({success: false, message: 'Failed to authenticate token.'})
      } else {
        req.decoded = decoded
        next()
      }
    })
  } 
  else {
    url = req.url ? util.format('/?url=%s', encodeURIComponent(req.url)) : '/';
    res.redirect(url)
  }
}

// oauth server # todo: make it optional
require('./components/oauth')(app, apiMiddleware)

const api = express.Router();

// api middleware
api.use(apiMiddleware);

// api logout
app.all('/logout', api, (req, res) => {
  req.session.destroy((err)=>{
    location = '/'
    if(req.body.url)
      location = req.body.url
    res.redirect(location)
  });
});

app.get('/user', api, (req, res) => {
  res.json({
    success: true,
    message: req.session.address
  });
});

// error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: app.get('env') === 'development' ? err : {}
  });
});

var listener = app.listen(process.env.PORT || 8080, () => {
  console.log('Listening on port ' + listener.address().port)
})