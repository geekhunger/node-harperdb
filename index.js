const request = require("needle")
const {add: vartype, check: type, assert} = require("type-approve")

const valid_json = obj => {
    try {return JSON.stringify(obj)}
    catch(error) {return null}
}

const valid_record = input => {
    return type({array: input}, {string: input}) ? input : [input]
}

const trim_records = input => {
    let records = valid_record(input)
    for(let record of records) {
        for(const attribute of Object.keys(record)) {
            if(/^__\w*time__$/i.test(attribute)) { // e.g.: __createdtime__, __updatedtime__
                delete record[attribute]
            }
        }
    }
    return records
}


class HarperDB {
    /*
        HarperDB connector
        Class instances 'mount' onto a db schema (namespace) and table to run queries on them
    */
    constructor(instance, auth, schema, table) {
        if(!(this instanceof HarperDB)) {
            return new HarperDB(instance, auth, schema, table)
        }
        this.instance = instance
        this.auth = auth
        this.schema = schema
        this.table = table
        this.primary_key = "id"
        this.schema_undefined = this.table_undefined = true
        this.timeout = 15000 // ms
    }


    async request(query) {
        const payload = type({string: query})
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
            timeout: this.timeout
        }
        const response = await request("post", this.instance, payload, settings)
        assert(!response?.body?.error, response.body.error)
        return response?.body
    }


    pipe(request, ...params) { // queue database operations to execute then later all at once
        assert(type({function: request}), "Could not batch request without a handler function!")
        if(!type({array: this.pipeline})) this.pipeline = [] // init queue
        this.pipeline.push(Promise.resolve(request.call(this, ...params))) // https://stackoverflow.com/q/60980357/4383587
    }


    async drain() { // concurrent execution of all pipelined database requests
        assert(type({array: this.pipeline}) && this.pipeline.length > 0, "Missing request batch!")
        let response = await Promise.all(this.pipeline)
        this.pipeline = undefined
        return response
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
            assert(/(not exists?)/gi.test(error.message), error) // propagate error if it didn't yield from a missing schema/table but from something other
            if(/^search/i.test(query.operation)) {
                return [] // don't create missing schema/table just yet, when it's a fetch request!
            }
            let schema
            if(this.schema_undefined) { // prepare schema
                try {
                    schema = await this.request({
                        operation: "describe_schema",
                        schema: this.schema
                    })
                } catch(_) {
                    await this.request({ // unfortunately, does not return the new schema description (another call might be needed to check the table on it)
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
                        await this.request({ // we don't need the info but if it's throws an error then we know it's missing
                            operation: "describe_table",
                            schema: this.schema,
                            table: this.table
                        })
                    } else {
                        assert(schema[this.table], `Missing table '${this.table}'!`)
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


    async insert(records) { // can be a single object or an array
        return await this.run({
            operation: "insert",
            schema: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async update(records) { // can be a single object or an array
        return await this.run({
            operation: "update",
            schema: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async upsert(records) { // can be a single object or an array
        return await this.run({
            operation: "upsert",
            schema: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async detete(uid) { // can be a single string or an array
        return await this.run({
            operation: "delete",
            schema: this.schema,
            table: this.table,
            hash_values: valid_record(uid)
        })
    }

    
    async uid(filter) {
        return (await this.select(filter)).map(rec => rec[this.primary_key])
    }


    async select(filter, limit) { // argument is optional, but could be an object, or an array (of strings or objects)
        if(!filter) {
            // without filtering attributes, the search will return the table structure
            return await this.run({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
        }

        let query = {
            operation: "search_by_conditions",
            schema: this.schema,
            table: this.table,
            get_attributes: ["*"],
            conditions: [],
            operator: "and",
            offset: 0,
            limit: type({number: limit}) ? parseInt(limit) : undefined // NOTE: Explicit value ot 'null' doesn't work (as stated in docs)! Set to 'undefined' instead.
        }

        if(type({object: filter})) {
            for(const [attr, val] of Object.entries(filter)) {
                if(!type({nil: val})) { // TODO This is a temporary workaround. I've submitted a ticket to HarperDB support and they've confirmed that this is a bug! Their suggestion is to use a SQLite SELECT query.
                    query.conditions.push({
                        search_attribute: attr,
                        search_value: val,
                        search_type: "equals"
                    })
                }
            }
            // search result will be an array of existing db records that 'match' all of the filtering attributes
            return await this.run(query)
        }
        
        if(type({array: filter}) && filter.every(vartype("string"))) {
            const struct = await this.run({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
            for(const attr of struct.attributes.map(attr => attr.attribute)) {
                for(const val of filter) {
                    if(!type({nil: val})) { // TODO (see above note about the bug)
                        query.conditions.push({
                            search_attribute: attr,
                            search_value: val,
                            search_type: "contains"
                        })
                    }
                }
            }
            // search result will be an array of existing db records that 'include' or 'contain' one or more filtering attrubutes
            // it's like searching a sub-string in text
            query.operator = "or"
            return await this.run(query)
        }

        if(type({array: filter}) && filter.every(vartype("object"))) {
            for(const rec of filter) this.pipe(this.select, rec) // piping to this.select as plain-object (not an array)!
            return (await this.drain()).flat()
        }

        assert(false, "Could not find any records because of malformed filtering!")
    }
}


module.exports = {
    HarperDB,
    database: (instance, auth, schema, table) => {
        if(!type({strings: [instance, auth]}) && type({object: this.db})) { // incomplete or no new credentials but a db instance already exists
            return this.db
        }
        assert(type({strings: [instance, auth]}) || type({object: this.db}), "Invalid credentials!")
        this.db = new HarperDB(instance, auth, schema ?? this.db?.schema, table ?? this.db?.table)
        return this.db
    },

    mount: (schema, table) => { // alias for swapping namespaces (omit 'new' keyword for class instances)
        assert(type({string: schema}), "Invalid schema name!")
        if(!type({string: table})) [schema, table] = schema.split(".") // support for object-like name chaining: "schema.table"
        assert(type({string: table}), "Invalid table name!")
        this.db = new HarperDB(this.db?.instance, this.db?.auth, schema, table)
        return this.db
    },

    run: query => { // more intuitive alias for running sql queries
        assert(type({object: this.db}), "Connection invalid!")
        return this.db?.request(query)
    }
}
