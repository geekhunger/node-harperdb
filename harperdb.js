import {request} from "needle"
import vartype from "type-approve"

const {
    add: getTypeValidationHandler,
    check: type,
    assert
} = vartype

const valid_json = obj => {
    try {
        return JSON.stringify(obj)
    } catch(error) {
        return null
    }
}

const valid_record = input => {
    return type({array: input}, {string: input})
        ? input
        : [input]
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

const trim_query = function(value) { // trim identation spaces and newlines within multiline strings encosed by ``
    return value
        .trim()
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join(" ")
}

const is_search_query = value => {
    const identifier = /^[\r\n\t\s]*search|select/i
    if((type({string: value}) && identifier.test(value))
    || (type({object: value}) && type({string: value.operation}) && identifier.test(value.operation)))
    {
        return true
    }
    return false
}

export class HarperDB {
    /*
        HarperDB connector
        Class instances 'mount' onto a db schema (namespace) and table to run queries on them
    */
    constructor(url, token, schema, table, primekey = "id") {
        if(!(this instanceof HarperDB)) {
            return new HarperDB(url, token, schema, table)
        }
        this.url = url
        this.token = token
        this.schema = schema
        this.table = table
        this.primekey = primekey
        this.timeout = 15000 // ms
    }


    async request(query) {
        const payload = type({string: query})
            ? valid_json({operation: "sql", sql: trim_query(query)})
            : valid_json(query)
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
        const response = await request("post", this.url, payload, settings)
        console.log(response)
        assert(!response?.body?.error, response?.body?.error)
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
            console.log(await this.request({operation: "describe_all"}))
            const response = await this.request(query)
            if(response) {
                this.schema_undefined = this.table_undefined = false
                return response
            }
            assert(this.schema_undefined === false && this.table_undefined === false, "Schema or table does not exist!")
        } catch(error) {
            if(is_search_query(query)
            && (/not exist/gi.test(error?.message || error)
            || /unknown attribute/gi.test(error?.message || error)))
            {
                return [] // don't create missing schema/table just yet, when it's a fetch request!
            }
            assert(/not exist/gi.test(error?.message || error), error) // propagate error if it didn't yield from a missing schema or table but from something other
            this.schema_undefined = this.table_undefined = true
            let schema, table
            if(this.schema_undefined) { // prepare schema
                try {
                    schema = await this.request({
                        operation: "describe_database",
                        database: this.schema
                    })
                    assert(!type({nil: schema}), "Schema does not exist!")
                } catch(_) {
                    await this.request({ // unfortunately, does not return the new schema description (another call might be needed to check the table on it)
                        operation: "create_database",
                        database: this.schema
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
                            database: this.schema,
                            table: this.table
                        })
                        console.log("!!!", table)
                        assert(!type({nil: table}), "Table does not exist!")
                    } else {
                        assert(schema[this.table], `Missing table '${this.table}'!`)
                        table = schema[this.table]
                    }
                    this.primekey = table.hash_attribute // update default primary key with the one that's actually set for this.table
                } catch(_) {
                    await this.request({
                        operation: "create_table",
                        database: this.schema,
                        table: this.table,
                        hash_attribute: this.primekey // default name of the uuid column
                    }).catch(() => {})
                } finally {
                    this.table_undefined = false
                }
            }
            console.log(this.schema_undefined, this.table_undefined, schema, table)
        } finally {
            await this.request(query) // retry
            console.log("try again:", query)
        }
    }


    async insert(records) { // can be a single object or an array
        return await this.run({
            operation: "insert",
            database: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async update(records) { // can be a single object or an array
        return await this.run({
            operation: "update",
            database: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async upsert(records) { // can be a single object or an array
        return await this.run({
            operation: "upsert",
            database: this.schema,
            table: this.table,
            records: trim_records(records)
        })
    }


    async detete(uid) { // can be a single string or an array
        return await this.run({
            operation: "delete",
            database: this.schema,
            table: this.table,
            hash_values: valid_record(uid)
        })
    }

    
    async uid(filter) {
        return (await this.select(filter)).map(rec => rec[this.primekey])
    }


    async select(filter, limit) { // argument is optional, but could be an object, or an array (of strings or objects)
        if(!filter) {
            // without filtering attributes, the search will return the table structure
            return await this.run({
                operation: "describe_table",
                database: this.schema,
                table: this.table
            })
        }

        let query = {
            operation: "search_by_conditions",
            database: this.schema,
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
        
        if(type({array: filter}) && filter.every(getTypeValidationHandler("string"))) {
            const struct = await this.run({
                operation: "describe_table",
                database: this.schema,
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

        if(type({array: filter}) && filter.every(getTypeValidationHandler("object"))) {
            for(const rec of filter) this.pipe(this.select, rec) // piping to this.select as plain-object (not an array)!
            return (await this.drain()).flat()
        }

        assert(false, "Could not find any records because of malformed filtering!")
    }
}

export default HarperDB
