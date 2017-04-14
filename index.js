const restify = require('restify')
const request = require('request')
const server = restify.createServer()
var $ = require('cheerio')
$.prototype.serializeArray = serializeArray
const cheerio = $
const agent = require('superagent').agent()
const jquery = require('jquery')
const urljoin = require('url-join')
const config = require('./config')

start()

async function start() {
  await login()
  createApi();
}

async function login() {
  const loginData = {
    'login[username]': config.username,
    'login[password]': config.password,
    'login[redirectUri]': config.host + '/login_process',
    'login[submit]': ''
  }

  const requestUrl = await getLoginRequestUrl()
  await agent
    .post(requestUrl)
  .type('form')
  .set('Referer', requestUrl)
    .send(loginData)
}

async function getLoginRequestUrl() {
  const url = urljoin(config.host, 'login')
  const res = await agent.get(url)
  return res.redirects[0]
}

function createApi() {
    server.use(restify.CORS())
    server.use(restify.bodyParser())
    /* work around curl not closing http connection */
    server.pre(restify.pre.userAgentConnection())

    server.put('/author/:id', authorPut);
    server.put('/:entity/:id', entityEdit);
    server.put('/:group/acl/:id', aclPut);
    server.post('/:entity/add', entityAdd);

    const port = process.env.PORT || 4555
    server.listen(port, function() {
      console.log('%s listening at %s', server.name, server.url);
    });
}

async function entityAdd(req, res) {
  let entity = req.params.entity

  switch(entity) {
    case 'media-outlet':
      entity = 'organization/media-outlet'
      break
    case 'person':
      break
    default:
      res.send(500)
      res.end()
  }

  const postUrl = urljoin(config.host, 'admin', entity, 'add')

  const postRes = await agent
    .post(postUrl)
    .type('form')
    .set('referer', postUrl)
    .send(req.body)

  if(200 != postRes.statusCode || !postRes.redirects) {
    res.send(500)
    res.end()
  }

console.log(postRes.redirects[0])
  const entityId = postRes.redirects[0].replace(/[\D]/g, '')
  res.send(201, entityId)
  res.end()
}

async function aclPut(req, res) {
  const group = req.params.group
  const id = req.params.id
  const validGroups = ['organization', 'person']
  let aclUserGroup
  let aclUserName

  const acl = {
    '_acl[entityId]': id
  }

  // customer or user?
  if(req.params.user) {
    aclUserGroup = 'user'
    aclUserName = req.params.user
    acl['_acl[userClass]'] = String.raw`Everlution\CommonBundle\Entity\UserEntity`
  } else if(req.params.customer) {
    aclUserGroup = 'customer'
    aclUserName = req.params.customer
    acl['_acl[userClass]'] = String.raw`Everlution\CommonBundle\Entity\CustomerEntity`
  } else {
    res.send(500)
    res.end()
  }

  if(!validGroups.includes(group)) {
    res.send(500)
    res.end()
  }

  acl['_acl[entityClass]'] = await getEntityClass(group, id)
  acl['_acl[acl]'] = getAclAcl(req.params.acl)
  const aclUser = await getAclUser(aclUserGroup, aclUserName)

  Object.assign(acl, aclUser)

  const postUrl = urljoin(config.host, 'admin/person/acl/add',  '%252Fadmin%252F' + group + '%252Facl%252F' + id + '%252Flist?id=' + id)
  const referer = urljoin(config.host, 'admin', group, 'acl', id, 'list')

  putData = {}
  for (var key in acl) {
    if (acl.hasOwnProperty(key)) {
      putData[aclUserGroup + key] = acl[key];
    }
  }
console.log(putData)

  const postRes = await agent
    .post(postUrl)
    .type('form')
    .set('referer', referer)
    .send(putData)

  res.send(postRes.statusCode, postRes.body)
  res.end()
}

function getAclAcl(reqAcls) {
  const aclMapping = {
    'view': '1',
    'create': '2',
    'edit': '4',
    'delete': '8'
  }

  let mappedAcl = []

  reqAcls.map(reqAcl => {
    if(aclMapping[reqAcl]) {
      mappedAcl.push(aclMapping[reqAcl])
    }
  })

  return mappedAcl
}

async function getAclUser(userGroup, userName) {
  const url = urljoin(config.host, 'admin', userGroup, 'autocomplete?term=' + userName)

  const res = await agent.get(url)
  const searchResults = JSON.parse(res.text)
  if(!searchResults[0]) {
    return
  }
  const topResult =  searchResults[0]

  let userAcl = {}
  userAcl['_acl[userId]'] = topResult.id
  userAcl['Name'] = topResult.label
  return userAcl
}

async function getEntityClass(group, id) {
  const url = config.host + '/admin/' + group + '/acl/' + id + '/list'
  const res = await agent.get(url)
  const $ = cheerio.load(res.text)
  const entityClass = $('#customer_acl_entityClass').val()
  return entityClass
}

async function entityEdit(req, res) {
  const entity = req.params.entity
  const entityId = req.params.id
  const validEntities = ['organisation', 'person']

  if(!validEntities.includes(entity)) {
    res.send(500)
    res.end()
  }

  const url = urljoin(config.host, 'admin', entity, entityId, 'edit')

  const getRes = await agent.get(url)

  const $ = cheerio.load(getRes.text)
  const form = $('#main_content form').serializeArray(true)
  const data = {}
  for(formEl of form) {
    data[formEl.name] = formEl.value
  }

  Object.assign(data, req.body)

  const postRes = await agent
    .post(url)
    .type('form')
    .set('Referer', url)
    .send(data)

  res.send(postRes.statusCode)
  res.end()

}

function authorPut(req, res, next) {
  const authorId = req.params.id;
  agent.get(config.host + '/admin/person/' + authorId + '/edit').end(function(err,res2) {
    var authorDetails = {}
    // read form here
    $('#main_content form', res2.text).serializeArray(true).forEach(function(formEl) {
      authorDetails[formEl.name] = formEl.value
    })
    // replace biogrpahy
    authorDetails["person[biography]"] = req.body.biography;
    agent
    .post(config.host + '/admin/person/' + authorId + '/edit')
    .type('form')
    .set('Referer', config.host + '/admin/person/' + authorId + '/edit')
    .send(authorDetails)
    .end(function(err, res3) {
      res.send(res3.statusCode, req.body);
      res.end();
    });
  });
}

var _ = require('lodash'),
    submittableSelector = 'input,select,textarea,keygen',
    rCRLF = /\r?\n/g;

function serializeArray (includeUndefinedValues = false) {
  // Resolve all form elements from either forms or collections of form elements
  var Cheerio = this.constructor
  return this.map(function() {
      var elem = this
      var $elem = Cheerio(elem)
      if (elem.name === 'form') {
        return $elem.find(submittableSelector).toArray()
      } else {
        return $elem.filter(submittableSelector).toArray()
      }
    }).filter(
        // Verify elements have a name (`attr.name`) and are not disabled (`:disabled`)
        '[name!=""]:not(:disabled)'
        // and cannot be clicked (`[type=submit]`) or are used in `x-www-form-urlencoded` (`[type=file]`)
        + ':not(:submit, :button, :image, :reset, :file)'
        // and are either checked/don't have a checkable state
        + ':matches([checked], :not(:checkbox, :radio))'
    // Convert each of the elements to its value(s)
    ).map(function(i, elem) {
      var $elem = Cheerio(elem)
      var name = $elem.attr('name')
      var val = $elem.val()

      if (val == null && includeUndefinedValues) {
        val = ''
      }

      // If there is no value set (e.g. `undefined`, `null`), then return nothing
      if (val == null) {
        return null
      } else {
        // If we have an array of values (e.g. `<select multiple>`), return an array of key/value pairs
        if (Array.isArray(val)) {
          return _.map(val, function(val) {
            // We trim replace any line endings (e.g. `\r` or `\r\n` with `\r\n`) to guarantee consistency across platforms
            //   These can occur inside of `<textarea>'s`
            return {name: name, value: val.replace( rCRLF, '\r\n' )}
          })
        // Otherwise (e.g. `<input type="text">`, return only one key/value pair
        } else {
          return {name: name, value: val.replace( rCRLF, '\r\n' )}
        }
      }
    // Convert our result to an array
    }).get()
}
