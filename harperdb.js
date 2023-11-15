import {
    type,
    add as typecheck,
    assert,
    validJson,
    validPayload,
    removeTimestamps,
    trimQuery,
    isSearchQuery
} from "./utility.js"

import request from "needle"

export class HarperDB {
    /*
        HarperDB connector
        Class instances 'mount' onto a db schema (namespace) and table to run queries on them
    */
    constructor(url, token, schema, table, primekey = "id", timeout = 15000) {
        if(!(this instanceof HarperDB)) {
            return new HarperDB(url, token, schema, table)
        }
        this.url = url
        this.token = token
        this.schema = schema
        this.table = table
        this.primekey = primekey
        this.timeout = timeout // ms
    }


    async request(query) {
        const payload = type({string: query})
            ? validJson({operation: "sql", sql: trimQuery(query)})
            : validJson(query)
        const settings = {
            headers: {
                "Accept": "application/json",
                "Cache-Control": "no-cache",
                "Authorization": "Basic " + this.token
            },
            json: true,
            parse: "json",
            timeout: this.timeout
        }
        try {
            const response = await request("post", this.url, payload, settings)
            assert(
                type({object: response}) &&
                type({nil: response.body?.error}) &&
                response.statusCode >= 200 &&
                response.statusCode <= 299,
                response.body?.error || response.body?.message || response.body || "No response!"
            )
            return response.body
        } catch(exception) {
            throw exception
        }
    }


    pipe(request, ...params) { // queue database operations to execute then later all at once
        assert(
            type({function: request}),
            "Could not batch request without a handler function!"
        )
        if(!type({array: this.pipeline})) {
            this.pipeline = [] // init queue
        }
        this.pipeline.push(
            Promise.resolve(request.call(this, ...params)) // https://stackoverflow.com/q/60980357/4383587
        )
    }


    async drain() { // concurrent execution of all pipelined database requests
        assert(
            type({array: this.pipeline}) &&
            this.pipeline.length > 0,
            "Missing request batch!"
        )
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
            if(isSearchQuery(query) && (/not exist/gi.test(error.message) || /unknown attribute/gi.test(error.message))) {
                return [] // don't create missing schema/table just yet, when it's not a write- but a read request!
            }
            assert(/not exist/gi.test(error.message), error) // propagate error if it didn't yield from a missing schema or table but from something other
            this.schema_undefined = this.table_undefined = true
            let schema, table
            if(this.schema_undefined) { // prepare schema
                try {
                    schema = await this.request({
                        operation: "describe_schema",
                        schema: this.schema
                    })
                } catch(_) {
                    await this.request({ // unfortunately, does not return the new schema description, another call might be needed to check the table on it
                        operation: "create_schema",
                        schema: this.schema
                    }).catch(() => {})
                } finally {
                    this.schema_undefined = false
                }
            }
            if(this.table_undefined) { // prepare table
                try {
                    if(!schema || !table) {
                        table = await this.request({
                            operation: "describe_table",
                            schema: this.schema,
                            table: this.table
                        })
                    } else {
                        assert(schema[this.table], `Missing table '${this.table}'!`)
                        table = schema[this.table]
                    }
                    this.primekey = table.hash_attribute // update default primary key with the one that's actually set for this.table
                } catch(_) {
                    console.log("!!!", this.primekey)
                    await this.request({
                        operation: "create_table",
                        schema: this.schema,
                        table: this.table,
                        hash_attribute: this.primekey // default name of the uuid column
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
            records: removeTimestamps(records)
        })
    }


    async update(records) { // can be a single object or an array
        return await this.run({
            operation: "update",
            schema: this.schema,
            table: this.table,
            records: removeTimestamps(records)
        })
    }


    async upsert(records) { // can be a single object or an array
        return await this.run({
            operation: "upsert",
            schema: this.schema,
            table: this.table,
            records: removeTimestamps(records)
        })
    }


    async detete(uid) { // can be a single string or an array
        return await this.run({
            operation: "delete",
            schema: this.schema,
            table: this.table,
            hash_values: validPayload(uid)
        })
    }

    
    async uid(filter) {
        return (await this.select(filter)).map(rec => rec[this.primekey])
    }


    async select(filter, limit) { // argument is optional, but could be an object, or an array (of strings or objects)
        if(!filter) {
            return await this.run({ // without filtering attributes, the search will return the table structure
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
            limit: type({number: limit}) ? parseInt(limit) : undefined // NOTE: Explicit value ot 'null' doesn't work, as stated in docs! Set to 'undefined' instead.
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
        
        if(type({array: filter}) && filter.every(typecheck("string"))) {
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

        if(type({array: filter}) && filter.every(typecheck("object"))) {
            for(const rec of filter) {
                this.pipe(this.select, rec) // piping to this.select as plain-object (not an array)!
            }
            return (await this.drain()).flat()
        }

        assert(false, "Could not find any records because of malformed filtering!")
    }
}

export default HarperDB
