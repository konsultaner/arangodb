/* jshint globalstrict:false, strict:false, unused : false */
/* global runSetup assertEqual, assertTrue, assertFalse, assertNull, fail */
// //////////////////////////////////////////////////////////////////////////////
// / DISCLAIMER
// /
// / Copyright 2014-2024 ArangoDB GmbH, Cologne, Germany
// / Copyright 2004-2014 triAGENS GmbH, Cologne, Germany
// /
// / Licensed under the Business Source License 1.1 (the "License");
// / you may not use this file except in compliance with the License.
// / You may obtain a copy of the License at
// /
// /     https://github.com/arangodb/arangodb/blob/devel/LICENSE
// /
// / Unless required by applicable law or agreed to in writing, software
// / distributed under the License is distributed on an "AS IS" BASIS,
// / WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// / See the License for the specific language governing permissions and
// / limitations under the License.
// /
// / Copyright holder is ArangoDB GmbH, Cologne, Germany
// /
/// @author Andrey Abramov
/// @author Copyright 2022, ArangoDB GmbH, Cologne, Germany
// //////////////////////////////////////////////////////////////////////////////

var db = require('@arangodb').db;
var internal = require('internal');
var jsunity = require('jsunity');

if (runSetup === true) {
  'use strict';
  global.instanceManager.debugClearFailAt();

  db._drop('UnitTestsRecoveryDummy');
  var c = db._create('UnitTestsRecoveryDummy');
  c.ensureIndex({ type: "inverted", name: "pupa", includeAllFields:true });

  var meta = { indexes: [ { collection: "UnitTestsRecoveryDummy", index: "pupa" } ] };
  db._dropView('UnitTestsRecoveryView');
  db._createView('UnitTestsRecoveryView', 'search-alias', meta);

  internal.wal.flush(true, true);
  global.instanceManager.debugSetFailAt("RocksDBBackgroundThread::run");
  internal.wait(2); // make sure failure point takes effect

  var tx = {
    collections: {
      write: ['UnitTestsRecoveryDummy']
    },
    action: function() {
      const db = require('internal').db;
      var c = db.UnitTestsRecoveryDummy;
      for (let j = 0; j < 100; j++) {
        var values = [];
        for (let i = 0; i < 100; i++) {
          values.push({ a: "foo_" + i, b: "bar_" + i, c: i });
        }
        c.save(values);
      }
    },
    waitForSync: true
  };

  db._executeTransaction(tx);

  return 0;
}

function recoverySuite () {
  'use strict';
  jsunity.jsUnity.attachAssertions();

  return {


    testIResearchLinkPopulateTransactionNoFlushThread: function () {
      let checkView = function(viewName, indexName) {
        let v = db._view(viewName);
        assertEqual(v.name(), viewName);
        assertEqual(v.type(), 'search-alias');
        let indexes = v.properties().indexes;
        assertEqual(1, indexes.length);
        assertEqual(indexName, indexes[0].index);
        assertEqual("UnitTestsRecoveryDummy", indexes[0].collection);
      };
      checkView("UnitTestsRecoveryView", "pupa");

      var result = db._query("FOR doc IN UnitTestsRecoveryView SEARCH doc.c >= 0 OPTIONS {waitForSync: true} COLLECT WITH COUNT INTO length RETURN length").toArray();
      var expectedResult = db._query("FOR doc IN UnitTestsRecoveryDummy FILTER doc.c >= 0 COLLECT WITH COUNT INTO length RETURN length").toArray();
      assertEqual(expectedResult[0], result[0]);
    }
  };
}

jsunity.run(recoverySuite);
return jsunity.done();
