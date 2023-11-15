import HarperDB from "./harperdb.js"
import vartype from "type-approve"

const {check: type, assert} = vartype
let datastore

export const connect = function(url, token, schema, table, primekey) {
    if(type({nil: table}) && type({string: schema}) && schema.includes(".")) {
        [schema, table] = schema.split(".") // support name chaining, eg. "schema.table"
    }
    if(datastore instanceof HarperDB) {
        if(type({nils: [url, token, schema, table, primekey]})) {
            return datastore // eg. `connect()` will return current db instance handle
        }
        if(type({strings: [url, token]})) {
            assert(type({strings: [schema, table]}), "Invalid HarperDB namespace!")
            datastore = new HarperDB(url, token, schema, table, primekey)
            return datastore
        }
        if(type({strings: [schema, table]})) {
            datastore.schema = schema
            datastore.table = table
        }
        if(type({string: primekey})) {
            datastore.primekey = primekey
        }
        return datastore
    }
    assert(type({strings: [url, token]}), "Invalid HarperDB credentials!")
    assert(type({strings: [schema, table]}), "Invalid HarperDB namespace!")
    assert(type({nil: primekey}) || type({string: primekey}), "Invalid HarperDB primekey!")
    datastore = new HarperDB(url, token, schema, table, primekey)
    return datastore
}

export const run = function(query) { // alias for running sql queries
    assert(datastore instanceof HarperDB, "Missing HarperDB connection!")
    return datastore.request(query)
}

export default {
    HarperDB,
    connect,
    run
}