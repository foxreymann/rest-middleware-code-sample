# description

REST API middleware to a CMS.

So the client needed to automate data operation on a database but only CMS access was provided. Solution was a REST API middleware working on top of the CMS.

# data manipulation workflow

1. Get data as HTML making a GET request
1. Extract data from HTML into JS object
1. Modify data in JS object
1. POST the data simulating a form submit

# technologies

Node.js with Async/Await

Restify

cheerio

JSON
