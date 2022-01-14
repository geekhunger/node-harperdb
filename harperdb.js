const request = require("needle")

const valid_record = input => {
    return Array.isArray(input) || typeof input === "string" ? input : [input]
}

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


    pipe(request, ...params) { // queue database operations to execute then later all at once
        if(typeof request !== "function") throw new Error("Could not batch request without a handler function!")
        if(!Array.isArray(this.pipeline)) this.pipeline = [] // init queue
        this.pipeline.push(Promise.resolve(request.call(this, ...params))) // https://stackoverflow.com/q/60980357/4383587
    }


    async drain() { // concurrent execution of all pipelined database requests
        if(Array.isArray(this.pipeline) && this.pipeline.length > 0) {
            let response = await Promise.all(this.pipeline)
            this.pipeline = undefined
            return response
        }
        throw new Error("Missing request batch!")
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
                throw error // propagate error if it didn't yield from a missing schema/table but from something other
            }
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
                        throw new Error(`Missing table '${this.table}'!`)
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
            records: valid_record(records)
        })
    }


    async update(records) { // can be a single object or an array
        return await this.run({
            operation: "update",
            schema: this.schema,
            table: this.table,
            records: valid_record(records)
        })
    }


    async upsert(records) { // can be a single object or an array
        records = valid_record(records)
        let insert_candidate = records.filter(elem => !!elem[this.primary_key])
        let update_candidate = records.filter(elem => !elem[this.primary_key])

        for(const rec of update_candidate) {
            if(!rec[this.primary_key]) {
                this.pipe(this.select, rec)
            }
        }

        for(let [pos, findings] of Object.entries(await this.drain())) {
            if(findings.length === 0 || findings.length > 1) {
                insert_candidate.push(update_candidate[pos])
                update_candidate[pos] = undefined
            } else {
                update_candidate[pos] = Object.assign(findings[0], update_candidate[pos])
            }
        }

        return await this.run({
            operation: "upsert",
            schema: this.schema,
            table: this.table,
            records: [insert_candidate, update_candidate.filter(Boolean)].flat(1) // remove undefined and unpack nested
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

    
    async uid(records) {
        return (await this.select(records)).map(rec => rec[this.primary_key])
    }


    async select(filter) { // argument is optional, but could be an object, or an array (of strings or objects)
        if(!filter) {
            // without filtering attributes, the search will return the table structure
            return await this.run({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
        }

        const is_array = elem => Array.isArray(elem)
        const is_object = elem => typeof elem === "object" && !is_array(elem)
        let query = {
            operation: "search_by_conditions",
            schema: this.schema,
            table: this.table,
            get_attributes: ["*"],
            conditions: [],
            operator: "and",
            offset: 0,
            limit: undefined // NOTE 'null' doesn't work as stated in docs!
        }

        if(is_object(filter)) {
            for(const [attr, val] of Object.entries(filter)) {
                if(val !== undefined && val !== null) { // TODO This is a temporary workaround. I've submitted a ticket to HarperDB support because it should possible to search for values of null!
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
        
        if(is_array(filter) && filter.every(elem => typeof elem === "string")) {
            const struct = await this.run({
                operation: "describe_table",
                schema: this.schema,
                table: this.table
            })
            for(const attr of struct.attributes.map(attr => attr.attribute)) {
                for(const val of filter) {
                    if(val !== undefined && val !== null) { // TODO (see ticket)
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

        if(is_array(filter) && filter.every(is_object)) {
            for(const rec of filter) this.pipe(this.select, rec) // NOTE piping to .select as plain-object (not an array)!
            return (await this.drain()).flat()
        }

        throw new Error("Could not find any records because of malformed filtering!")
    }
}


module.exports = {
    database: (instance, auth, schema, table) => {
        if(!(instance && auth) && !!this.db) {
            return this.db
        }
        if((typeof instance !== "string" || typeof auth !== "string") && !this.db) {
            throw new Error("Invalid credentials!")
        }
        this.db = new HarperDB(instance, auth, schema ?? this.db?.schema, table ?? this.db?.table)
        return this.db
    },

    mount: (schema, table) => { // alias for swapping namespaces (omit 'new' keyword for class instances)
        if(typeof schema !== "string") throw new Error("Invalid schema name!")
        if(typeof table !== "string") [schema, table] = schema.split(".") // support for object-like name chaining: "schema.table"
        if(typeof table !== "string") throw new Error("Invalid table name!")
        this.db = new HarperDB(this.db?.instance, this.db?.auth, schema, table)
        return this.db
    },

    run: query => { // more intuitive alias for running sql queries
        if(!this.db) throw new Error("Connection invalid!")
        return this.db?.request(query)
    }
}
