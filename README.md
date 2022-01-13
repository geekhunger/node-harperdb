<style type="text/css">
    .center {margin: 0 auto;}
    .headroom {margin-top: 48px;}
    .narrow {max-width: 60%;}
    .grid-2 {display: grid; grid-template-columns: repeat(2, minmax(0, auto)); align-items: start; align-self: center; justify-items: center}
</style>

# node-harperdb

## Why?

[HarperDB](https://harperdb.io) is a distributed realtime JSON cloud database. It's highly scalable, has low-latency and is super easy to use and maintain. There are even build-in cloud functions, loadbalancing and other great goodies! Their free tier service plan is certainly capable of running decent applications too. But, their [HTTP API](https://api.harperdb.io) is not a turnkey solution.

<p align="center"><img src="img/harperdb.png" height="64"></p>


## TL;DR

```shell
npm i node-harperdb
```
```js
const {database, mount, run} = require("node-harperdb")
```

### Instance Properties
- db.instance
- db.auth
- db.schema
- db.table
- db.primary_key

#### Private Instance Properties
- db.schema_undefined
- db.table_undefined
- db.pipeline

### Instance Methods
- `db.request(query)`
- `db.run(query)`
- `db.insert(record)`
- `db.insert(record)`
- `db.update(record)`
- `db.upsert(record)`
- `db.select(filter)`
- `db.delete(query)`
- `db.pipe(request, ...params)`
- `db.drain()`

```js
!async function() {
    const db = database(
        "https://foobar-geekhunger.harperdbcloud.com", // Instance-URL
        "aGFsbG86Z2Vla2h1bmdlcg==" // Basic-Auth Base64 token
        "production", // db schema (alias namespace)
        "users" // db table
    )

    await db.insert([
        {email: "first@user.at"},
        {email: "second@user.to"}
    ])

    const users = await db.select()

    console.log(users)
}()
```




<hr class="headroom">

## Preparations

First, visit [HarperDB Studio](https://studio.harperdb.io) and create your free account (or sign in if you already have one).

Create a new Organization and a new HarperDB Cloud Instance within it. - The Cloud Instance is sort of your VPS that is hosting your installation of HarperDB. You can have one for free, with fixed specs; additional Instances need to be paid separately.

<div class="narrow center">
    <p class="grid-2 center">
        <img src="img/instance-create.jpg">
        <img src="img/instance-preview.jpg">
    </p>
    <img src="img/instance-plan.jpg" class="center">
    <p class="grid-2 center ">
        <img src="img/instance-meta.jpg">
        <img src="img/instance-specs.jpg">
    </p>
</div>

Once you have your Instance (it takes a moment), switch to the 'config' tab and grab your Instance-URL and Basic-Auth token.

Now, go back to your project and install this package from NPM: `npm i node-harperdb`




<hr class="headroom">

## Connect to your HarperDB (Cloud) Instance

`require("node-harperdb")` returns an object with three functions `{database, mount, run}`. You don't have to use all of them, but you'll need at least `{database}`.

Use `database(instance, auth [,schema] [,table])` to connect to your HarperDB Cloud Instance. (Use the credentials obtained in ['Preparations'](#preparations) step.)

The return value of this function is a handle to a class instance (of the underlaying HarperDB class). See [the list of class methods below](#harperdb-class-methods) for detailed information about each one of them.

> When calling `database` **without** arguments then you get back the handle of the currently connected HarperDB Instance. (It throws an error if you have not yet connected.)

```js
const {database} = require("node-harperdb")

database() // NOT OK: Throws an error about missing credentials!

database("https://foobar-geekhunger.harperdbcloud.com", "aGFsbG86Z2Vla2h1bmdlcg==") // connect to your Cloud Instance

let db = database() // OK: Returns a handle to the current connection. Use it to execute requests on the database.
```

> When calling `database` **with** arguments, then `instance` and `auth` become mandatory! But `schema` and `table` remain always optional.<br>

```js
const {database, mount, run} = require("node-harperdb")
const db = database("https://foobar-geekhunger.harperdbcloud.com", "aGFsbG86Z2Vla2h1bmdlcg==")
```

Once connected, you can switch the schema and table at any time.because you can always swap them with `mount(schema, table)` which is really a shortcut to do `database()`.







<br class="headroom">

## HarperDB class methods:

<hr class="headroom">

- ### `db.request(query)`

Fundamentally, a [`needle`](https://www.npmjs.com/package/needle) 'POST' request handler. It sets required request headers, converts the `query` payload input into JSON and sends-off the HTTP request to the HarperDB HTTP API. The response from the API is then parsed into JSON and returned back as a JS object.

> This function is used by every class method of the underlaying HarperDB class.

The `query` argument itself can be passed as a JS Object, an Array of Objects, or as a String (raw SQL statement). See the official [HarperDB API docs](https://api.harperdb.io) for more information on the structure of these requests.

```js
// run a SQLite query
const response = await db.request({
    "operation": "sql",
    "sql": "SELECT * FROM dev.dog WHERE id = 1"
})
```
```js
// or same but simpler...
const response = await db.request("SELECT * FROM dev.dog WHERE id = 1")
console.log(response)
```
```js
// or as a raw HarperDB NoSQL operation (example taken 1:1 from HarperDB docs)
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


<br class="headroom">

- ### `db.run(query)`

Very similar to `db.request` but with one key difference: **It prepares the database table before running queries on it!** - For example, if you were to execute `db.insert()` on a missing schema and/or table, then this funcion would create them 🧙🏼🪄automagically before running the query.




<br class="headroom">

- ### `db.insert(query)`

Runs [an 'insert' NoSQL operation](https://api.harperdb.io/#c4eebe37-2c6e-4a66-90da-f2aa3cf5d03e) on the current table.

```js
const harper = require("harperdb")
const db = harper.database(
    "https://foobar-geekhunger.harperdbcloud.com",
    "aGFsbG86Z2Vla2h1bmdlcg==",
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

> **NOTE** that you can also omit the primary key ('id' in this example). HarperDB API will automatically generate a random hash instead, if you do (e.g. 'f4fad12f-675d-458b-924b-021970a6e14e')!




<br class="headroom">

- ### `db.update(query)`

Note, that according to the [official docs](https://api.harperdb.io/#17d21958-00b7-4e5f-a55e-c476700073fb)  you'd need to specify the 'id' (primary key) for every record in the `query`. - However, **this** one is precious!

- If your `query` items *do contain* an 'id' that matches a corresponding record in the database, then it will work just as described by the official docs. (It simply updates the values in the database for that entry.)
- If your `query` items *do not* contain an 'id', then it will try to find these records in the database...
    - and if there is an *exact match*, then values get updated as expected.
    - However, if *nothing is found* in the database (**or there's more than one entry matching** a particular record from your `query`), then it will fallback onto a `db.insert` operation instead, for that record!

Long story short, it works **very similar** to a `db.upsert()`. But in contrast, `db.update` does **not** update every matching record blindly. Instead, it only updates records that match-up exactly and *only if* there's only one single find in the database (not many)! (See `db.upsert` for reverse comparison too.)

```js
const {database} = require("harperdb")

!async function() {
    database( // connect to your instance
        "https://foobar-geekhunger.harperdbcloud.com",
        "aGFsbG86Z2Vla2h1bmdlcg==",
        "dev",
        "dog"
    )
    
    try {
        const response = await database().update({ 
            "weight_lbs": 55
        })
        console.log(response)
    } catch(exception) {
        console.error(exception) // always guard your db calls
    }
}
```




<br class="headroom">

- ### `db.upsert(query)`

> It works **very similar** to `db.update` *but* with one key difference. For example, if you had two identical entries in your database (except for their id's), then `db.upsert()` would update **both** of them. Whereas `db.update()` would update **none** and instead create a new entry in the database!

Refer to `db.insert` and `db.update` [(and the official docs)](https://api.harperdb.io/#df1beea1-6628-4592-84c7-925b7191ea2c) for more details.




<br class="headroom">

- ### `db.delete(query)`
[delete docs](https://api.harperdb.io/#beaf5116-ad34-4360-bdc2-608e2743a514)

```js
const harper = require("harperdb")
const db = harper.database("https://foobar-geekhunger.harperdbcloud.com", "aGFsbG86Z2Vla2h1bmdlcg==")

db.insert({
    "id": 8,
    "dog_name": "Harper",
    "breed_id": 346,
    "age": 7
})
.catch(console.error)
.then(console.log)
```
```js
// or as a raw HarperDB NoSQL operation as shown in their docs
db.request({
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




<br class="headroom">

- ### `db.select(filter)`
- ### `db.pipe(request, ...params)`
- ### `db.drain()`

```txt
TODO: Please be patient, I'm on it.. ;-)
```




