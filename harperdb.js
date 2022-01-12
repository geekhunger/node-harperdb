const request = require("needle")
const valid_record = input => Array.isArray(input) || typeof input === "string" ? input : [input]
const valid_json = obj => {
    try {return JSON.stringify(obj)}
    catch(error) {return null}
}


class HarperDB {
    /*
        HarperDB connector
        Class instances 'mount' onto a db schema (namespace) and table to run queries on them
    */
    constructor(instance, auth, schema, table) {
        this.instance = instance
        this.auth = auth
        this.schema = schema
        this.table = table
        this.primary_key = "id"
        this.schema_undefined = this.table_undefined = true
    }


    async request(query) {
        const payload = typeof query === "string"
            ? valid_json({operation: "sql", sql: query})
            : valid_json(query)
        const settings = {
            headers: {
                "Accept": "application/json",
                "Cache-Control": "no-cache",
                "Authorization": "Basic " + this.auth
            },
            json: true,
            parse: "json",
            timeout: 15000 // ms
        }
        const response = (await request("post", this.instance, payload, settings))
        if(response?.body?.error) throw new Error(response.body.error)
        return response?.body
    }


    async run(query) {
        /*
            Argument can be any valid SQL query string
            or a command object accepted by HarperDB
            NOTE The first call will create missing schema and/or table recursevly!
        */
        try {
            const response = await this.request(query)
            this.schema_undefined = this.table_undefined = false
            return response
        } catch(error) {
            if(!/(not exists?)/gi.test(error.message)) {
                throw error // propagate error if it resulted not from missing schema/table
            }
            let schema
            if(this.schema_undefined) { // prepare schema
                try {
                    schema = await this.request({
                        operation: "describe_schema",
                        schema: this.schema
                    })
                } catch(_) {
                    await this.request({
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
                        await this.request({
                            operation: "describe_table",
                            schema: this.schema,
                            table: this.table
                        })
                    } else if(!schema[this.table]) {
                        throw new Error(`Table '${this.table}' not defined`)
                    }
                } catch(_) {
                    await this.request({
                        operation: "create_table",
                        schema: this.schema,
                        table: this.table,
                        hash_attribute: this.primary_key // default name of the uuid column
                    }).catch(() => {})
                } finally {
                    this.table_undefined = false
                }
            }
        }
        return await this.request(query) // retry
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
            const schema = await this.request({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
            const primary_key = schema.hash_attribute
            for(let new_item of record) {
                if(!new_item[primary_key]) {
                    const db_entry = await this.select(new_item)
                    switch(db_entry.length) {
                        case 0: break; // no primary key available because does not exist in db yet!
                        case 1: new_item[primary_key] = db_entry[0][primary_key]; break; // already exist (copy its primary key)
                        default: //console.info(`Found ${db_entry.length} existing entries in database that match a new record from an 'upsert' command (expected 1 entry at most)! Instead of updating an existing entry a new record will be created.`, {new: new_item, existing: db_entry})
                    }
                }
            }
        } catch(_) {
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
        if(!filter) { // The search result will be a table schema description if no filtering options have been set, for example: db.select()
            //console.info(`Selecting records from database without filtering options will return the table schema instead of a search result!`)
            return table
        }
        let match
        const conditions = []
        if(typeof filter === "object" && !Array.isArray(filter)) { // The search result will be an exact match of all attributes and values from the filtering options, for example: db.select({username: "geekhunger", email: "hallo@geekhunger.de"})
            match = "and"
            for(const [attr, val] of Object.entries(filter)) {
                conditions.push({
                    search_attribute: attr,
                    search_value: val,
                    search_type: "equals"
                })
            }
        } else {
            if(!Array.isArray(filter)) {
                throw new Error("Could not select records from database because filtering options are malformed! Filter must be either nothing, an object of attributes and values for an exact match, or an array of values to search for.")
            }
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


    pipe(request, ...params) { // queue database operations to execute then later all at once
        if(typeof request !== "function") throw new Error("Could not batch request without any handler function!")
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
    database: (instance, auth) => {
        if(!(instance && auth) && !!this.db) {
            return this.db
        }
        if((typeof instance !== "string" || typeof auth !== "string") && !this.db) {
            throw new Error("Credentials invalid!")
        }
        this.db = new HarperDB(instance, auth, this.db?.schema, this.db?.table)
        return this.db
    },

    mount: (schema, table) => { // alias for swapping namespaces (omit 'new' keyword for class instances)
        if(typeof schema !== "string") throw new Error("Schema not specified")
        if(typeof table !== "string") [schema, table] = schema.split(".") // support for object-like name chaining: "schema.table"
        if(typeof table !== "string") throw new Error("Table not specified")
        this.db = new HarperDB(this.db?.instance, this.db?.auth, schema, table)
        return this.db
    },

    run: query => { // more intuitive alias for running sql queries
        if(!this.db) throw new Error("Connection invalid!")
        return this.db?.request(query)
    }
}
