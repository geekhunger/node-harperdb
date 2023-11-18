# Readme
## Notes

> **Important:** Version 2.0.2 introduces **breaking changes!**
>
> - Rewritten from CJS to ESM
> - Function `database()` has been renamed to `connect()`
> - `mount()` has been removed entirely
>
> You can write your own `mount()` function or module, if you like to...
>
> ```js
> import {connect} from "node-harperdb"
>
> export const CREDENTIALS = {
>   url: "https://foobar-geekhunger.harperdbcloud.com",
>   token: "aGFsbG22Z2vla2m1bmdMc0==",
>   schema: "foobar"
> }
>
> export const mount = function(table, primekey = "id", timeout = 15000) {
>    return connect(
>       CREDENTIALS.url,
>       CREDENTIALS.token,
>       CREDENTIALS.schema,
>       table,
>       primekey,
>       timeout
>   )
> }
>
> export default mount
>```
>
> **One word of warning:** I use this package for some of my personal projects and therefore I might introduce breaking changes in future updates (or maybe not 🤗 ). If you plan to use this package in production, you should better fork the Git repo and maintain it yourself!
>
> **Alternative:** If you want an alternative to this package, then there's also [Harperive](https://www.npmjs.com/package/harperive).


<br>
<br>
<p align="center"><img src="img/harperdb.png" height="64"></p>

## Why?

[HarperDB](https://harperdb.io) is a distributed realtime JSON cloud database. It's highly scalable, low-latency, has dynamic schemas and is super easy to use and maintain. There are even build-in cloud functions, build-in loadbalancing and other great goodies! The free tier service plan is certainly capable of running decent applications too. Have a look at the [HTTP API](https://api.harperdb.io) for more details.


<br>
<br>

## TL;DR

```shell
npm i node-harperdb
```
```js
import {HarperDB, connect, run} from "node-harperdb"
```
```js
!async function() {
    const client = connect(
        "https://foobar-geekhunger.harperdbcloud.com", // Instance-URL
        "aGFsbG22Z2vla2m1bmdMc0==" // Basic-Auth Base64 token
        "production", // db schema (alias namespace)
        "users" // db table
    )

    await client.insert([
        {email: "first@user.at"},
        {email: "second@user.to"}
    ])

    const users = await client.select()

    console.log(users)
}()
```


<br>
<br>

### Public class properties
- `.url` is your HarperDB *Instance URL*
- `.token` is your HarperDB *Instance API Auth* token
- `.schema` is your HarperDB schema (could be any realm identifier like a project name)
- `.table` is your HarperDB table which holds your records
- `.timeout` in milliseconds (default is 1500 ms)
- `.primekey` is the *name* of the primary table column, if you will. Values in this field are guaranteed to be unique identifiers. HarperDB calls it *the table `hash_attribute`*. I call it the `primekey`. Default name is `'id'`.

#### Private class properties - *DON'T MESS WITH THESE!*
- `.schema_undefined` is used as a lookup flag to see if a schema was already defined in your HarperDB instance or not. If it didn't, then it will be created upon the very first occuring request to HarperDB (on that schema).
- `.table_undefined` is the same as *db.schema_undefined* but for tables
- `.pipeline` is the registry of queued requests - *db.drain()* flushes this array every time

### Public class methods
- [`.pipe(request, ...params)`](#db-pipe)
- [`.drain()`](#db-drain)
- [`.run(query)`](#db-run)
- [`.insert(records)`](#db-insert)
- [`.update(records)`](#db-update)
- [`.upsert(records)`](#db-upsert)
- [`.delete(uid)`](#db-delete)
- [`.uid(filter)`](#db-uid)
- [`.select(filter, limit)`](#db-select)

#### Private class methods
- [`.request(query)`](#db-request)


<br>
<br>

## Preparation

First, visit [HarperDB Studio](https://studio.harperdb.io) and create your free account (or sign in if you already have one).

Create a new Organization and a new HarperDB Cloud Instance within it. - The Cloud Instance is sort of your VPS that is hosting your installation of HarperDB. You can have one for free, with fixed specs; additional Instances need to be paid separately.

<img src="img/instance-create.jpg">
<br>
<img src="img/instance-preview.jpg">
<br>
<img src="img/instance-plan.jpg">
<br>
<img src="img/instance-meta.jpg">
<br>
<img src="img/instance-specs.jpg">

Once you have your Instance (it takes a moment), switch to the 'config' tab and grab your *Instance URL* and *Instance API Auth* token.

<img src="img/instance-credentials.jpg">

Now, go back to your project and install this package from NPM: `npm i node-harperdb`


<br>
<br>

## Connect to your HarperDB (Cloud) Instance

`await import("node-harperdb")` returns an object with three functions `{HarperDB, connect, run}`. You don't have to use all of them, but you'll need at least the `{connect}` *or* `{HarperDB}` constructor!

> `HarperDB` is the underlaying class object. `connect(...)` is just a shortcut to `new HarperDB(...)` which lets you omit the `new` keyword. However, when using this shortcut, you can only have **one** single instance of a HarperDB connection at a time! With `new HarperDB`, on the other hand, you can create as many connections as you like. Every one of these instances could for example be connected to a different HarperDB (Cloud) Instance, or just to a different schema and table within the same HarperDB Instance!
>
> Another benefit of having `HarperDB` is that you can check a connection with `instanceof HarperDB` is an instance of the HarperDB class.
>
> ```js
> import {HarperDB, connect} from "node-harperdb"
> const db = connect(...)
> //const db = new HarperDB(...) // or connect like this
> console.log(db instanceof HarperDB) // true
> ```

Use `connect(url, token, schema, table [, primekey, timeout])` or `new HarperDB(url, token, schema, table [, primekey, timeout])` to connect to your HarperDB Cloud Instance. Use the credentials obtained in ['Preparations'](#preparations) step.

Using `connect(...)` should be fine most of the time. If you need to work with more than one database table at the same time, then use `new HarperDB(...)`.

```js
import {connect} from "node-harperdb"
const db = new HarperDB("https://foobar-geekhunger.harperdbcloud.com", "aGFsbG22Z2vla2m1bmdMc0==", "foo", "bar")
```

> The constructor does not actually 'connect' to a server via sockets or something... not immediately at least. It simply stores your credentials inside `db.url` (URL) and `db.token` (Basic-Auth token) properties and uses those values in the HTTP requests that it makes to HarperDB HTTP API. You can swap out credendials, schema or table at any time, without worrying about opening or closing any connections, because there is really no connection until you fire your request.

The return value of the constructor is a handle to the class instance (of the underlaying HarperDB class), on which you call methods like insert, update, select and so on. (See the [list of available class methods](#class-methods) below, for detailed information on each method.)

- When calling `connect(url, token, schema, table, primekey, timeout)` **with arguments**, then `url` and `token`, `schema` and `table` are mandatore. `primekey` is optional and defaults to `'id'` and `timeout` defaults to `15000` milliseconds. Same applies to the `new HarperDB()` call.

- When calling `connect()` **without arguments** then you get back the handle of the currently 'connected' HarperDB Instance. (It throws an error if you have not yet connected.)

```js
import {connect, run} from "node-harperdb"

connect() // BAD: Cannot fetch db handle because of missing credentials!

connect("https://foobar-geekhunger.harperdbcloud.com", "aGFsbG22Z2vla2m1bmdMc0==", "mvp", "test") // connect to your Cloud Instance

let db = connect() // GOOD: Returns a handle to the current db connection. Use it to execute requests on the database.

connect().insert({...}) // do something here...
```


<br>
<br>

## Class methods


- <h3 id="db-request"><code>db.request(query)</code></h3>

Fundamentally, a [`needle`](https://www.npmjs.com/package/needle) 'POST' request handler. It sets required request headers, converts the `query` payload input into JSON and sends-off the HTTP request to the HarperDB HTTP API. The response from the API is then parsed into JSON and returned back as a JS object. So, JS-in and JS-out.

The `query` argument can be passed as an Object, an Array of Objects, or as a String. - Normally, you simply pass a JS object that looks exactly as you want it to be saved in the database. One Object equals one db entry. An array of Objects means multiple database entries. Strings are handy for SQLite queries! (Yes, HarperDB has you covered, my friend!)

Objects would be a so called [NoSQL request](https://api.harperdb.io/#257368f1-2c13-433f-bf99-b650d7421c77) in HarperDB. A NoSQL request has a descrete JSON structure that you need to maintain in order to get a successful response back from HarperDB Web API.

Luckily, you don't have to worry about that, because `db.request` does the conversion automatically! But here's an example anyways...

```js
// run a NoSQL operation
const response = db.request({
    "operation": "delete",
    "schema": "dev",
    "table": "dog",
    "hash_values": [1]
})
```
```js
// run a SQLite query
const response = await db.request({
    "operation": "sql",
    "sql": "SELECT * FROM dev.dog WHERE id = 1"
})
```
```js
// run a SQLite query WITHOUT HARDCODING the schema and table names!
const response = await db.request({
    "operation": "sql",
    "sql": `SELECT * FROM ${db.schema}.${db.table} WHERE id = 1`
})
```

This is were Strings come in... If `query` argument is a String then it will be interpreted as a [raw SQL statements](https://harperdb.io/docs/sql-overview)! (*Yes,* you have the **full power of SQLite** at your desposal!) `db.request` will wrap the string into an object (as shown in previous example) and send if off.

```js
// here's the exact same SQLite query but simpler...
const response = await db.request(`
    SELECT *
    FROM ${db.schema}.${db.table}
    WHERE id = 1
`)
console.log(response)
```

If you plan on building your own request for some reason, then refer to the official [HarperDB API documentation](https://api.harperdb.io). ([If you want to dig deeper, I suggest you lookup topics on SQLite and JSONata.](https://harperdb.io/docs/sql-overview/sql-json-search))

```js
// Here's a raw HarperDB NoSQL operation. This example is taken 1:1 from HarperDB docs!
db.request({
    "operation": "search_by_hash",
    "schema": "dev",
    "table": "dog",
    "hash_values": [
        1,
        2
    ],
    "get_attributes": [
        "dog_name",
        "breed_id"
    ]
})
.catch(console.error)
.then(console.log)
```


<br>

- <h3 id="db-run"><code>db.run(query)</code></h3>

Very similar to `db.request` but with one key difference: **It prepares the database table before running queries on it!** - For example, if you were to execute `db.insert()` on a missing schema and/or table, then this function would 🪄automagically create them *and then* run your request on it. (*db.request* would simply error, saying that the schema/table is missing.)

> Obviously, the schema and table would *not* be created just yet, if it's a read request, like 'search_by_conditions'. Namespaces are only auto-created on write operations like 'insert'.

```js
const db = connect(
    "https://foobar-geekhunger.harperdbcloud.com",
    "aGFsbG22Z2vla2m1bmdMc0==",
    "foo.bar" // schema and table in one go, separated by a dot, is same as `db.schema = "foo"; db.table = "bar";`
)
try {
    console.log(await connect().select({username: "foobar"})) // will not create table "bar" because it's a read request
    console.log(await connect().upsert({username: "foobar"})) // will create table "bar" and write a new record into it!
    console.log(await connect().select({username: "foobar"}))
} catch(error) {
    console.trace(error)
}
```
```js
connect()
.select(`
    update foo.bar
    set username = "raboof"
    where id = 'uid-hash-of-your-existing-record'
`)
.catch(console.trace) // your reject handler
.then(response => { // your resolve handler
    console.log(response)
})
```


<br>

- <h3 id="db-insert"><code>db.insert(records)</code></h3>

Add one or more records to the current table. [(Read more about it here.)](https://api.harperdb.io/#c4eebe37-2c6e-4a66-90da-f2aa3cf5d03e)

> Note that *you can safely omit the primary key* ('id' in this example). The HarperDB API will automatically generate and assign a random hash to it instead (e.g. 'f4fad12f-675d-458b-924b-021970a6e14e')!

```js
// NoSQL operation
import harper from "harperdb" // import the entire namespace of constructors
const db = harper.connect(
    "https://foobar-geekhunger.harperdbcloud.com",
    "aGFsbG22Z2vla2m1bmdMc0==",
    "dev",
    "dog"
)
db.insert([
    {
        "id": 8,
        "dog_name": "Harper",
        "breed_id": 346,
        "age": 7
    },
    {
        // "id": 9, // primary key is always optional!
        "dog_name": "Penny",
        "breed_id": 154,
        "age": 7
    }
])
.catch(console.error)
.then(console.log)
```
```js
// same as raw HarperDB NoSQL operation as shown in their docs
await db.request({
    "operation": "insert",
    "schema": "dev",
    "table": "dog",
    "records": [
        {
            "id": 8,
            "dog_name": "Harper",
            "breed_id": 346,
            "age": 7
        },
        {
            "id": 9,
            "dog_name": "Penny",
            "breed_id": 154,
            "age": 7
        }
    ]
})
```


<br>

- <h3 id="db-update"><code>db.update(records)</code></h3>

This method simply updates values on an existing db record. - As always, please refer to [official docs](https://api.harperdb.io/#17d21958-00b7-4e5f-a55e-c476700073fb) if you need more information; but it's mostly self-explanatory.

Just keep in mind that *you need to specify the primary key for your record(s)* because otherwise HarperDB doesn't know which record you want to update. (You *can* use the [`db.uid({...})`](#db-uid) to obtain it!)

```js
!async function() {
    import {connect} from "harperdb"

    connect( // connect to your instance
        "https://foobar-geekhunger.harperdbcloud.com",
        "aGFsbG22Z2vla2m1bmdMc0==",
        "dev",
        "dog"
    )
    
    try {
        const response = await connect().update({ 
            "weight_lbs": 55
        })
        console.log(response)
    } catch(exception) {
        console.error(exception) // always guard your db calls
    }
}()
```


<br>

- <h3 id="db-upsert"><code>db.upsert(records)</code></h3>

This method is a cute combination of a `db.insert` and `db.update`. This is a native API method of the HarperDB API. [(Read more about it here.)](https://api.harperdb.io/#df1beea1-6628-4592-84c7-925b7191ea2c)

```js
import {connect} from "harperdb"

const db = connect( // connect to your instance
    "https://foobar-geekhunger.harperdbcloud.com",
    "aGFsbG22Z2vla2m1bmdMc0==",
    "foo",
    "users"
)

const entries = [ // prepare data that needs to exist in db
    {fullname: "petric star", username: "pepo", email: "pepo@gmail.com"},
    {fullname: "mr crabs", username: "cabi", email: "crabs@hotmail.me"}
]

try {
    let findings = await db.select(entries) // records already in db?
    findings.map(record => record.active = true) // yes! update their status!
    console.log(await db.update(findings))
} catch(error) { // not in db yet? well, then add it...
    db
    .upsert(entries)
    .catch(console.error)
    .then(console.log)
}
```

<p align="center">
    <img src="img/upsert-step1.jpg">
    <img src="img/upsert-step1-record1.jpg">
    <img src="img/upsert-step1-record2.jpg">
    <img src="img/upsert-step2.jpg">
    <img src="img/upsert-step12-console.jpg">
</p>

Here's an example of what would happen, if you were to run the upsert without checking for existing records or without passing their UIDs...

```js
import {connect} from "harperdb"

connect(
    "https://foobar-geekhunger.harperdbcloud.com",
    "aGFsbG22Z2vla2m1bmdMc0==",
    "foo",
    "users"
)

const entries = [
    {fullname: "petric star", username: "pepo", email: "pepo@gmail.com"},
    {fullname: "mr crabs", username: "cabi", email: "crabs@hotmail.me"}
]

connect()
.upsert(entries)
.catch(console.error)
.then(console.log)
```

<p align="center">
    <img src="img/upsert-step3-console.jpg">
    <img src="img/upsert-step3.jpg">
</p>


<br>

- <h3 id="db-delete"><code>db.delete(uid)</code></h3>

Well, does what is says.^^ Deletes one or more records from the database by their UIDs. [(See an example from official docs.)](https://api.harperdb.io/#beaf5116-ad34-4360-bdc2-608e2743a514)

The fallowing example fetches records by certain conditions and passes those records directly to the `db.delete` method for deletion.

```js
connect() // get db handle
.delete( // call NoSQL delete operation on db
    connect() // get db handle
    .select([ // find records by attributes and values
        {email: "pepo@gmail.com", fullname: "petric star"},
        {email: "crabs@hotmail.me"}
    ])
    .catch(console.error)
)
.catch(console.error)
.then(console.log)
```

It's possible to fetch UIDs explicitly and pass *them* to the deletion method. In the fallowing example, `db.uid()` will perform a *db.select()* to fetch records of interest and then map each record to its *primekey*. The result is an array of UIDs for the matching records. Eventually, we pass those *ids* to *db.delete()* for deletion.

```js
const ids = connect().uid([
    {email: "pepo@gmail.com", fullname: "petric star"},
    {email: "crabs@hotmail.me"}
])
connect().delete(ids)
```


<br>

- <h3 id="db-select"><code>db.select(filter, limit)</code></h3>

It's basically a syntactial wrapper around the [search_by_conditions](https://api.harperdb.io/#c820c353-e7f6-4280-aa82-83be77857653) operation of HarperDB.

You pass an array of strings and it does kind of a 'fuzzy search' on the database... Every db entry (and every of its attributes) will be compared agains every of your values in the `filter` array, and the results will be returned. So, it's basically an operation that sounds like this: attribute 'id' does 'contains' the value 'hello world' 'or' attribute 'fullname' does 'contains' the value 'hello world' 'or' ... and so on. It tries to match every attribute in db agains every value in your list. Thank kind of search...😅

```js
const db = connect(...)
let findings = await db.select(["attribute contains this sub-string", "hello world", "Peter", "Joe"])
console.log(findings)
```

If you pass an object (instead of an array of strings), then the select method will look for an *exact* match of the given attributes and value pairs from your `filter` object. So, it's basically a: this attribute 'equals' this value 'and' that attribute 'equals' that value...

```js
findings = await db.select({
    fullname: "Joe McMillan",
    age: 25
})
```

You can also pass an *array* of objects. (Behind the scenes [db.pipe](#db-pipe) and [db.drain](#db-drain) will be used. The request will be asynchronous, meaning, it will not wait sequentially for every search query to finish, but rather run them all in parallel and wait on that bigger Promise to resolve.)

```js
findings = await db.select([
    {fullname: "Joe McMillan", age: 25}, // trying to find a specific person
    {email: "noreply@pdftoaster.com"} // filtering out all entries with this email address
])
```

*Optinally,* you can also `limit` the number of findings in the response with every described variant. (Works basically the same as a SQL query: `select * from schema.table where attribute1 = value1 and attribute2 = value2,... LIMIT 25`)

Another interesting and useful but very confusing and ugly looking variant of db.select is to filter database records by nested JS objects or arrays...

For example: You have a 'user' table with primekey named 'id'. The 'id' attribute contains a username which is globally unique. Every user has a 'roles' attribute **which is an array** of strings.

#### Selection filter from nested objects and arrays

Sometimes you'll need to select records filtered by attributes that contain an object or array. [Please refer to the SEARCH_JSON documentation (but be warned, it's a very ugly syntax^^).](https://harperdb.io/docs/sql-overview/sql-json-search)

Here's an example, if you want to select users from the database by their usernames. Note, this is pure SQL syntax.

```js
function selectUsersByUsernames(usernames) {
    return db.run(`
        select *
        from ${db.schema}.${db.table}
        where ${db.primekey} in (
            ${usernames.map(name => `"${name}"`).join(",")}
        )
    `)
}

selectUsersByUsernames(["babyface777", "rosebud", "geekhunger"])
.catch(console.error)
.then(console.log)
```

If you'd want to select e.g. by roles instead, and the *roles* attribute is an array of strings in your database, then try something like this:

```js
function selectUsersByRoles(list) {
    return db.run(`
        select *
        from ${db.schema}.${db.table}
        where search_json('$[$ in ${JSON.stringify(list)}]', roles)
    `)
}

selectUsersByRoles(["admin", "manager", "supervisor"])
.catch(console.error)
.then(console.log)
```


<br>

- <h3 id="db-uid"><code>db.uid(filter)</code></h3>

Fetches the unique identifiers of one or more records (in other words, the attribute value with the *name* `db.primekey`). Mostly useful when you want to update or delete some entries in your database. [(You can explore more details in the official docs.)](https://api.harperdb.io/#beaf5116-ad34-4360-bdc2-608e2743a514)

```js
connect()
.uid([
    {email: "crabs@hotmail.me"}
])
.catch(console.error)
.then(console.log)
```


<br>

### `db.pipe(req, ...args)` & `db.drain()`

- <h4 id="db-pipe"><code>db.pipe(request, ...params)</code></h4>

Sometimes you might want fire many queries in parallel and in the meantime continue with other requests. - For example: You want to insert a couple records into the database and fetch something entirely different, all at the same time.

Well, you'd need to somehow cache your db operations and run them later with `Promise.all` all at once. But every class method already returns a Promise and it fires the request to HarperDB immediately. So how do you do that?

`db.pipe` is a `Promise` wrapper. You can use it to queue up your requests and and run them later. To run your queued request use [`db.drain()`](#db-drain)!

`db.pipe` will simply wrap every `request` method into a `Promise` and store it inside the `db.pipeline` queue. Once you call `db.drain()`, it will wrap all of those batched requests into a `Promise.all` and send off all of the queued requests at the same time! And finally, it will flush `db.pipeline`.

Requests will execute asynchronously! You can just leave it... or you can 'await' the resolved Promise. It's up to you.

```js
db.pipe(db.upsert, [ // This is synchronous, so no need to await it...
    {title: "Hello World", text: "Welcome to my new blog! This..."},
    {title: "Projects 2022", text: "New year, new luck. 2021 marked..."},
    {title: "HarperDB: The best database for...", text: "Did you know about HarperDB? Harper..."}
])

db.drain() // I do not await it, because I don't care about the result at this point...

const users = await db.select("select * from blog.users order by id asc") // In the meantime let's fetch all registred blog users...
console.log(users)
```
```js
for(const record of array_of_records) {
    // do something...
    db.pipe(db.select, record) // fetch! BUT not just yet.. for now just queue up the request for later
}
const findings = await db.drain() // NOW, fetch the all of the results of the queued up requests!
```

> **NOTE:** `db.pipe()` is the only function that is synchronous. Every other class method returns a Promise!


<br>

- <h4 id="db-drain"><code>db.drain()</code></h4>

[`db.pipe`](#db-pipe) will save-up queries for later execution. `db.drain` is the finalizer to `db.pipe`!

`db.drain` will wrap all of the single Promises from `db.pipeline` (which were stored there by db.drain) into a new super-mega-wrapped😅 `Promise.all` Promise. It will then execute the queued queries asynchronously all at once and flush the `db.pipeline` array.

The return value (once the Promise is resolve) is an array of responses.


<br>

## SQL queries

The `node-harperdb` package is largely a wrapper around the available NoSQL operations of the HarperDB API. It was created to provide cleaner and easier syntax for interacting with your HarperDB (Cloud) Instance. **If execution performance is critical to your application,** I'd suggest you use `{run}` (from module import call) or [`db.request(query)`](#db-request) and pass it a valid SQL statement directly, instead of using methods like `insert`, `update`, `select` and so on.

*`db.request()` has actually this neat shortcut...*

```js
import {connect, run} from "node-harperdb"
run("select * from foo.bar limit 1") // equivalent to: db.request("...")
```

Raw SQL queries have some advantages over NoSQL operations too. You can actually cut on the number of requests that are made to the HarperDB API. Especially, when aggregating data. SQL would be more efficient and convenient at selecting and joining tables than, say, `db.select`. (It also puts the processing load onto your (Cloud) VPS where HarperDB is running, instead of your own web server.)

> When using SQL statements, you can also safely omit the schema and table settings in the constructor because you need to include them inside your SQL queries anyways. No need for duplication here.

```js
import {connect, run} from "node-harperdb"

// Simpler constructor call
// with credentials to your HarperDB (Cloud) Instance
// but without schema and table.
connect("https://url...", "token...")

// Execute SQL statements without db.schema and without db.table
// run() is equivalent to db.request()
run("select * from foo.bar limit 1")
```

