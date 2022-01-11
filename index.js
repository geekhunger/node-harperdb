const ROOTPATH = require("app-root-path")
const share = ROOTPATH.require("share")
const {PACKAGE, CREDENTIALS} = share
const {typecheck, assert} = share.fn
const request = require("needle")


request.defaults({
    headers: {
        "User-Agent": PACKAGE.name,
        "Cache-Control": "no-cache",
        "Authorization": "Basic " + CREDENTIALS.harperdb.token,
        "Accept": "application/json"
    },
    parse_response: "json",
    timeout: CREDENTIALS.harperdb.timeout
})


const valid_json = function(obj) {
    try {return JSON.stringify(obj)}
    catch(error) {return null}
}


const valid_record = function(input) {
    return Array.isArray(input) || typeof input === "string" ? input : [input]
}


const post = async function(query) {
    const response = (await request(
        "POST",
        CREDENTIALS.harperdb.url,
        typeof query === "string" ? valid_json({operation: "sql", sql: query}) : valid_json(query),
        {json: true}
    )).body
    if(response.error) {
        throw new Error(response.error)
    }
    return response
}


/*
    HarperDB connector
    Class instances 'mount' to a db schema (namespace) and a table to runs queries on them
    Fallowing examples do the same:
        const db = new HarperDB("dev", "blog_posts")
        const db = new HarperDB("dev.blog_posts") // argument will be split into [schema, table]
        db.insert({title: "hello world", content: "welcome to my cool blog"})
        db.upsert({title: "hello world", content: "welcome to my cool blog"})
        const post_id = db.run(`select * from ${db.schema}.${db.table} where title is like 'hello%'`)
        db.delete(post_id)
*/
class HarperDB {
    constructor(schema, table) {
        if(typeof schema !== "string") throw new Error("Schema not specified")
        if(typeof table !== "string") [schema, table] = schema.split(".")
        if(typeof table !== "string") throw new Error("Table not specified")
        this.schema = schema
        this.table = table
        this.schema_undefined = this.table_undefined = true
    }

    /*
        Argument can be any valid SQL query string
        or a command object accepted by HarperDB
        NOTE The first call will create missing schema and/or table recursevly!
    */
    async run(query) {
        try {
            const response = await post(query)
            this.schema_undefined = this.table_undefined = false
            return response
        } catch(error) {
            if(!/(not exists?)/gi.test(error.message)) {
                throw error // propagate error if it resulted not from missing schema/table
            }
            let schema
            if(this.schema_undefined) { // prepare schema
                try {
                    schema = await post({
                        operation: "describe_schema",
                        schema: this.schema
                    })
                } catch(quiet) {
                    await post({
                        operation: "create_schema",
                        schema: this.schema
                    }).catch(() => {})
                } finally {
                    this.schema_undefined = false
                }
            }
            if(this.table_undefined) { // prepare table
                try {
                    if(!schema) {
                        await post({
                            operation: "describe_table",
                            schema: this.schema,
                            table: this.table
                        })
                    } else if(!schema[this.table]) {
                        throw new Error(`Table '${this.table}' not defined`)
                    }
                } catch(quiet) {
                    await post({
                        operation: "create_table",
                        schema: this.schema,
                        table: this.table,
                        hash_attribute: "id" // default name of the uuid column
                    }).catch(() => {})
                } finally {
                    this.table_undefined = false
                }
            }
        }
        return await post(query) // retry
    }


    async insert(record) { // can be a single object or an array
        return await this.run({
            operation: "insert",
            schema: this.schema,
            table: this.table,
            records: valid_record(record)
        })
    }


    async update(record) { // can be a single object or an array
        return await this.run({
            operation: "update",
            schema: this.schema,
            table: this.table,
            records: valid_record(record)
        })
    }


    async upsert(record) { // can be a single object or an array
        record = valid_record(record)
        try { // check if payload records contain primary keys, otherwise find their primary keys and use then in the request, such that we don't trigger creation of new records in the database
            const schema = await post({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
            const primary_key = schema.hash_attribute
            for(let new_item of record) {
                if(typecheck({nil: new_item[primary_key]}, false)) {
                    const db_entry = await this.select(new_item)
                    switch(db_entry.length) {
                        case 0: break; // no primary key available because does not exist in db yet!
                        case 1: new_item[primary_key] = db_entry[0][primary_key]; break; // already exist (copy its primary key)
                        default: //console.info(`Found ${db_entry.length} existing entries in database that match a new record from an 'upsert' command (expected 1 entry at most)! Instead of updating an existing entry a new record will be created.`, {new: new_item, existing: db_entry})
                    }
                }
            }
        } catch(quiet) {
        } finally {
            return await this.run({
                operation: "upsert",
                schema: this.schema,
                table: this.table,
                records: record
            })
        }
    }


    async select(filter) { // can be optional, or an object (exact match), or an array
        const table = await this.run({
            operation: "describe_table",
            schema: this.schema,
            table: this.table
        })
        if(typecheck({nil: filter}, false)) { // The search result will be a table schema description if no filtering options have been set, for example: db.select()
            //console.info(`Selecting records from database without filtering options will return the table schema instead of a search result!`)
            return table
        }
        let match
        const conditions = []
        if(typecheck({object: filter}, false)) { // The search result will be an exact match of all attributes and values from the filtering options, for example: db.select({username: "geekhunger", email: "hallo@geekhunger.de"})
            match = "and"
            for(const [attr, val] of Object.entries(filter)) {
                conditions.push({
                    search_attribute: attr,
                    search_value: val,
                    search_type: "equals"
                })
            }
        } else {
            assert(typecheck({array: filter}, false), "Could not select records from database because filtering options are malformed! Filter must be either nothing, an object of attributes and values for an exact match, or an array of values to search for.")
            for(const attr of table.attributes.map(attr => attr.attribute)) { // collect all available attributes from table schema and create one search query for every attribute and value combination
                for(const val of filter) {
                    conditions.push({
                        search_attribute: attr,
                        search_value: val,
                        search_type: "contains"
                    })
                }
            }
        }
        return await this.run({ // The search result will contain any record that 'includes' one or more of the value from the filtering options, for example `db.select(["hello"])` will match entries that contain the 'hello' sub-string in any of their attributes!
            operation: "search_by_conditions",
            schema: this.schema,
            table: this.table,
            get_attributes: ["*"],
            conditions: conditions,
            operator: match || "or",
            offset: 0,
            limit: undefined // NOTE 'null' doesn't work as stated in docs!
        })
    }


    async detete(identifier) { // can be a single string or an array
        return await this.run({
            operation: "delete",
            schema: this.schema,
            table: this.table,
            hash_values: valid_record(identifier)
        })
    }


    pipe(request, ...params) {
        assert(typeof request === "function", "Could not batch request without any handler function!")
        if(!Array.isArray(this.pipeline)) this.pipeline = [] // init queue
        this.pipeline.push(Promise.resolve(request.call(this, ...params))) // https://stackoverflow.com/q/60980357/4383587
    }


    async drain() { // concurrent execution of all pipelined database requests
        const response = await Promise.all(this.pipeline || [])
        this.pipeline = [] // reset queue
        return response
    }
}


module.exports = {
    Database: HarperDB,
    mount: (...arg) => new HarperDB(...arg), // alias for swapping namespaces (omit 'new' keyword for class instances)
    run: post // alias for running sql queries
}
