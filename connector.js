import HarperDB from "./harperdb.js"
import vartype from "type-approve"

const {check: type, assert} = vartype
let DB

export const connect = function(url, token, schema, table, primekey) {
    if(type({nil: table}) && type({string: schema}) && schema.includes(".")) {
        [schema, table] = schema.split(".") // support name chaining, eg. "schema.table"
    }
    if(DB instanceof HarperDB) {
        if(type({nils: [url, token, schema, table, primekey]})) {
            return DB // eg. `connect()` will return current db instance handle
        }
        if(type({strings: [url, token]})) {
            assert(type({strings: [schema, table]}), "Invalid HarperDB namespace!")
            DB = new HarperDB(url, token, schema, table, primekey)
            return DB
        }
        if(type({strings: [schema, table]})) {
            DB.schema = schema
            DB.table = table
        }
        if(type({string: primekey})) {
            DB.primary_key = primekey
        }
        return DB
    }
    assert(type({strings: [url, token]}), "Invalid HarperDB credentials!")
    assert(type({strings: [schema, table]}), "Invalid HarperDB namespace!")
    assert(type({nil: primekey}) || type({string: primekey}), "Invalid HarperDB primekey!")
    DB = new HarperDB(url, token, schema, table, primekey)
    return DB
}

export const run = function(query) { // alias for running sql queries
    assert(DB instanceof HarperDB, "Missing HarperDB connection!")
    return DB.request(query)
}

export default {
    HarperDB,
    connect,
    run
}
