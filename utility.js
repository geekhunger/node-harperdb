import {type, assert} from "type-approve"

export const validJson = function(input) {
    try {
        return JSON.stringify(input)
    } catch(_) {
        return null
    }
}

export const validPayload = function(input) {
    assert(type({string: input}, {array: input}), "Argument must be string or an array of strings!")
    return type({string: input})
        ? [input]
        : input
}

export const removeTimestamps = function(input) {
    let records = validPayload(input)
    for(let record of records) {
        for(const attribute of Object.keys(record)) {
            if(/^__\w*time__$/i.test(attribute)) { // e.g.: __createdtime__, __updatedtime__
                delete record[attribute]
            }
        }
    }
    return records
}

export const trimQuery = function(value) { // trim identation spaces and newlines within multiline strings encosed by ``
    return value
        .trim()
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join(" ")
}

export const isSearchQuery = function(value) {
    const identifier = /^[\r\n\t\s]*search|select/i
    if((type({string: value}) && identifier.test(value))
    || (type({object: value}) && type({string: value.operation}) && identifier.test(value.operation)))
    {
        return true
    }
    return false
}
