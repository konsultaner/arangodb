////////////////////////////////////////////////////////////////////////////////
/// DISCLAIMER
///
/// Copyright 2014-2024 ArangoDB GmbH, Cologne, Germany
/// Copyright 2004-2014 triAGENS GmbH, Cologne, Germany
///
/// Licensed under the Business Source License 1.1 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     https://github.com/arangodb/arangodb/blob/devel/LICENSE
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is ArangoDB GmbH, Cologne, Germany
///
/// @author Julia Volmer
////////////////////////////////////////////////////////////////////////////////
#pragma once

#include <iostream>
#include <memory>
#include <optional>
#include <source_location>
#include <string>
#include <thread>
#include "Inspection/Types.h"
#include "fmt/format.h"
#include "fmt/std.h"

namespace {
// helper type for the visitor
template<class... Ts>
struct overloaded : Ts... {
  using Ts::operator()...;
};
template<class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;
}  // namespace
namespace arangodb::async_registry {

struct ThreadRegistry;

struct Thread {
  std::string name;
  std::thread::id id;
  bool operator==(Thread const&) const = default;
};
template<typename Inspector>
auto inspect(Inspector& f, Thread& x) {
  return f.object(x).fields(f.field("name", x.name),
                            f.field("id", fmt::format("{}", x.id)));
}

struct SourceLocationSnapshot {
  std::string_view file_name;
  std::string_view function_name;
  std::uint_least32_t line;
  bool operator==(SourceLocationSnapshot const&) const = default;
};
template<typename Inspector>
auto inspect(Inspector& f, SourceLocationSnapshot& x) {
  return f.object(x).fields(f.field("file_name", x.file_name),
                            f.field("line", x.line),
                            f.field("function_name", x.function_name));
}
struct SourceLocation {
  auto snapshot() -> SourceLocationSnapshot {
    return SourceLocationSnapshot{.file_name = file_name,
                                  .function_name = function_name,
                                  .line = line.load()};
  }
  const std::string_view file_name;
  const std::string_view function_name;
  std::atomic<std::uint_least32_t> line;
};

enum class State { Running = 0, Suspended, Resolved, Deleted };
template<typename Inspector>
auto inspect(Inspector& f, State& x) {
  return f.enumeration(x).values(State::Running, "Running", State::Suspended,
                                 "Suspended", State::Resolved, "Resolved",
                                 State::Deleted, "Deleted");
}

using AsyncWaiter = void*;
using SyncWaiter = std::thread::id;
struct NoWaiter {
  bool operator==(NoWaiter const&) const = default;
};
template<typename Inspector>
auto inspect(Inspector& f, NoWaiter& x) {
  return f.object(x).fields();
}

struct AsyncWaiterTmp {
  AsyncWaiter item;
};
template<typename Inspector>
auto inspect(Inspector& f, AsyncWaiterTmp& x) {
  return f.object(x).fields(
      f.field("async", reinterpret_cast<intptr_t>(x.item)));
}
struct SyncWaiterTmp {
  SyncWaiter item;
};
template<typename Inspector>
auto inspect(Inspector& f, SyncWaiterTmp& x) {
  return f.object(x).fields(f.field("sync", fmt::format("{}", x.item)));
}
struct WaiterTmp : std::variant<AsyncWaiterTmp, SyncWaiterTmp, NoWaiter> {};
template<typename Inspector>
auto inspect(Inspector& f, WaiterTmp& x) {
  return f.variant(x).unqualified().alternatives(
      inspection::inlineType<NoWaiter>(),
      inspection::inlineType<AsyncWaiterTmp>(),
      inspection::inlineType<SyncWaiterTmp>());
}
struct Waiter : std::variant<NoWaiter, AsyncWaiter, SyncWaiter> {};
template<typename Inspector>
auto inspect(Inspector& f, Waiter& x) {
  if constexpr (!Inspector::isLoading) {  // only serialize
    WaiterTmp tmp = std::visit(
        overloaded{
            [&](AsyncWaiter waiter) {
              return WaiterTmp{AsyncWaiterTmp{waiter}};
            },
            [&](SyncWaiter waiter) { return WaiterTmp{SyncWaiterTmp{waiter}}; },
            [&](NoWaiter waiter) { return WaiterTmp{waiter}; },
        },
        x);
    return f.apply(tmp);
  }
}

struct PromiseSnapshot {
  void* id;
  Thread thread;
  SourceLocationSnapshot source_location;
  Waiter waiter = {NoWaiter{}};
  State state;
  bool operator==(PromiseSnapshot const&) const = default;
};
template<typename Inspector>
auto inspect(Inspector& f, PromiseSnapshot& x) {
  return f.object(x).fields(f.field("owning_thread", x.thread),
                            f.field("source_location", x.source_location),
                            f.field("id", reinterpret_cast<intptr_t>(x.id)),
                            f.field("waiter", x.waiter),
                            f.field("state", x.state));
}
struct Promise {
  Promise(Promise* next, std::shared_ptr<ThreadRegistry> registry,
          std::source_location location);
  ~Promise() = default;

  auto mark_for_deletion() noexcept -> void;
  auto id() -> void* { return this; }
  auto snapshot() -> PromiseSnapshot {
    return PromiseSnapshot{.id = id(),
                           .thread = thread,
                           .source_location = source_location.snapshot(),
                           .waiter = waiter.load(),
                           .state = state.load()};
  }

  Thread thread;

  SourceLocation source_location;
  std::atomic<Waiter> waiter = Waiter{NoWaiter{}};
  std::atomic<State> state = State::Running;
  // identifies the promise list it belongs to
  std::shared_ptr<ThreadRegistry> registry;
  Promise* next = nullptr;
  // this needs to be an atomic because it is accessed during garbage
  // collection which can happen in a different thread. This thread will
  // load the value. Since there is only one transition, i.e. from nullptr
  // to non-null ptr, any missed update will result in a pessimistic
  // execution and not an error. More precise, the item might not be
  // deleted, although it is not in head position and can be deleted. It
  // will be deleted next round.
  std::atomic<Promise*> previous = nullptr;
  // only needed to garbage collect promises
  Promise* next_to_free = nullptr;
};

struct AddToAsyncRegistry {
  AddToAsyncRegistry() = default;
  AddToAsyncRegistry(std::source_location loc);
  AddToAsyncRegistry(AddToAsyncRegistry const&) = delete;
  AddToAsyncRegistry& operator=(AddToAsyncRegistry const&) = delete;
  AddToAsyncRegistry(AddToAsyncRegistry&&) = delete;
  AddToAsyncRegistry& operator=(AddToAsyncRegistry&&) = delete;
  ~AddToAsyncRegistry();

  auto set_promise_waiter(AsyncWaiter waiter) {
    if (promise_in_registry != nullptr) {
      promise_in_registry->waiter.store({{waiter}});
    }
  }
  auto set_promise_waiter(SyncWaiter waiter) {
    if (promise_in_registry != nullptr) {
      promise_in_registry->waiter.store({{waiter}});
    }
  }
  auto id() -> void* {
    if (promise_in_registry != nullptr) {
      return promise_in_registry->id();
    } else {
      return nullptr;
    }
  }
  auto update_source_location(std::source_location loc) {
    if (promise_in_registry != nullptr) {
      promise_in_registry->source_location.line.store(loc.line());
    }
  }
  auto update_state(State state) {
    if (promise_in_registry != nullptr) {
      promise_in_registry->state.store(state);
    }
  }

 private:
  struct noop {
    void operator()(void*) {}
  };

 public:
  std::unique_ptr<Promise, noop> promise_in_registry = nullptr;
};

}  // namespace arangodb::async_registry
