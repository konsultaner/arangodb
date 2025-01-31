/*jshint globalstrict:false, strict:false */
/*global assertEqual, assertNotUndefined, assertTrue, assertEqual, assertTypeOf, assertNotEqual, fail, assertFalse */

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
/// @author Dr. Frank Celler
/// @author Copyright 2012, triAGENS GmbH, Cologne, Germany
// //////////////////////////////////////////////////////////////////////////////

var jsunity = require("jsunity");
var arangodb = require("@arangodb");
var db = arangodb.db;

function CollectionCacheSuite () {
  const cn = "UnitTestsClusterCache";
  return {
    
    setUp : function () {
      try {
        db._drop(cn);
      } catch (err) {
      }
    },

    tearDown : function () {
      try {
        db._drop(cn);
      } catch (err) {
      }
    },
    
    testCollectionCache : function () {
      let c = db._create(cn, {cacheEnabled:true});
      let p = c.properties();
      assertTrue(p.cacheEnabled, p);

      let f = c.figures();
      assertTrue(f.cacheInUse, f);
      assertTrue(f.cacheSize > 0);
      assertEqual(f.cacheUsage, 0);
      assertEqual(f.cacheLifeTimeHitRate, 0);

      let idxs = c.indexes(true);
      idxs.forEach(function(idx) {
        if (idx.type === 'primary') {
          assertTrue(idx.figures.cacheInUse, idx);
          assertEqual(idx.figures.cacheUsage, 0);
        }
      });
    },

    testCollectionCacheModifyProperties : function () {
      // create collection without cache
      let c = db._create(cn, {cacheEnabled:false});
      let p = c.properties();
      assertFalse(p.cacheEnabled, p);
      let f = c.figures();
      assertFalse(f.cacheInUse, f);
      let idxs = c.indexes(true);
      idxs.forEach(function(idx) {
        if (idx.type === 'primary') {
          assertFalse(idx.figures.cacheInUse);
          assertEqual(idx.figures.cacheUsage, 0);
        }
      });

      // enable caches
      c.properties({cacheEnabled:true});
      p = c.properties();
      assertTrue(p.cacheEnabled, p);
      f = c.figures();
      assertTrue(f.cacheInUse, f);
      assertEqual(f.cacheLifeTimeHitRate, 0);
      idxs = c.indexes(true);
      idxs.forEach(function(idx) {
        if (idx.type === 'primary') {
          assertTrue(idx.figures.cacheInUse);
          assertEqual(idx.figures.cacheUsage, 0);
        }
      });

      // disable caches again
      c.properties({cacheEnabled:false});
      p = c.properties();
      assertFalse(p.cacheEnabled, p);
      f = c.figures();
      assertFalse(f.cacheInUse, f);
      idxs = c.indexes(true);
      idxs.forEach(function(idx) {
        if (idx.type === 'primary') {
          assertFalse(idx.figures.cacheInUse);
          assertEqual(idx.figures.cacheUsage, 0);
        }
      });
    },

    testCollectionCacheBehavior : function () {
      let c = db._create(cn, {cacheEnabled:true});
      let p = c.properties();
      assertTrue(p.cacheEnabled, p);

      for(let i = 0; i < 10; i++) {
        let docs = [];
        for(let j = 0; j < 1000; j++) {
          const v = (i * 1000) + j;
          docs.push({_key:String(v), value : v});
        }
        c.insert(docs);
      }

      let f = c.figures();
      assertTrue(f.cacheInUse, f);
      assertTrue(f.cacheSize > 0);
      assertEqual(f.cacheUsage, 0);
      assertEqual(f.cacheLifeTimeHitRate, 0);

      let idxs = c.indexes(true);
      idxs.forEach(function(idx, i) {
        if (idx.figures.cacheInUse) {
          assertTrue(idx.figures.cacheSize > 0);
          assertEqual(idx.figures.cacheUsage, 0);
          assertEqual(idx.figures.cacheLifeTimeHitRate, 0);
        }
      });

      // hit 25% 
      for(let i = 0; i < 2500; i++) {
        let doc = c.document(String(i));
        assertNotUndefined(doc);
      }

      f = c.figures();
      assertTrue(f.cacheInUse, f);
      assertTrue(f.cacheSize > 0);

      // hit same 25% 
      for(let i = 0; i < 2500; i++) {
        let doc = c.document(String(i));
        assertNotUndefined(doc);
      }

      // no new documents were hit
      f = c.figures();
      assertTrue(f.cacheInUse);

      // hit different 25% 
      for(let i = 5000; i < 7500; i++) {
        let doc = c.document(String(i));
        assertNotUndefined(doc);
      }

      f = c.figures();
      assertTrue(f.cacheInUse);
    }
  };
}

jsunity.run(CollectionCacheSuite);

return jsunity.done();
