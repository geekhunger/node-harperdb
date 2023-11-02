import HarperDB from "./harperdb.js"
import vartype from "type-approve"

const {
    check: type,
    assert
} = vartype

export const connect = function(instance, auth, schema, table) {
    if(!type({strings: [instance, auth]}) && this.db instanceof HarperDB) { // incomplete or no new credentials but db instance already exists
        return this.db
    }
    assert(type({strings: [instance, auth]}) || this.db instanceof HarperDB, "Invalid credentials!")
    this.db = new HarperDB(instance, auth, schema ?? this.db?.schema, table ?? this.db?.table)
    return this.db
}

export const mount = function(schema, table, primekey) { // alias for swapping namespaces, allows to omit 'new' keyword with class instances
    assert(type({string: schema}), "Invalid schema name!")
    if(!type({string: table})) {
        [schema, table] = schema.split(".") // support for object-like name chaining of `schema` argument, eg. "schema.table"
    }
    assert(type({string: table}), "Invalid table name!")
    this.db.schema = schema
    this.db.table = table
    if(type({string: primekey})) {
        assert(primekey.trim().length > 0, "Invalid primary key!")
        this.db.primary_key = primekey
    }
    return this.db
}

export const run = function(query) { // more intuitive alias for running sql queries
    assert(this.db instanceof HarperDB, "Connection invalid!")
    return this.db.request(query)
}

export default {
    HarperDB,
    connect,
    mount,
    run
}
