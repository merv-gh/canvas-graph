1. Scalability & Performance Fundamentals
Horizontal vs. Vertical Scaling — when to use each
Load Balancing — algorithms (round-robin, least connections, IP hash, weighted)
Auto-scaling — scale-up/scale-down triggers, cooldown periods
Throughput vs. Latency — tradeoffs and optimization strategies
CAP Theorem — Consistency, Availability, Partition tolerance (and PACELC)
ACID vs. BASE — transactional vs. eventually consistent systems
Rate Limiting — token bucket, leaky bucket, fixed/sliding window counters
Backpressure — handling overload gracefully
Capacity Planning — QPS/RPS estimation, storage growth, bandwidth math
2. Database & Storage Design
SQL vs. NoSQL — relational, document, key-value, wide-column, graph, time-series
Database Sharding — hash-based, range-based, geo-based; resharding strategies
Replication — master-slave, master-master, synchronous vs. asynchronous
Read Replicas — eventual consistency, replication lag
Indexing — B-trees, LSM trees, inverted indexes, composite indexes, covering indexes
Query Optimization — execution plans, N+1 problem, denormalization
Partitioning — horizontal vs. vertical, partition pruning
Transactions — isolation levels (RU, RC, RR, Serializable), deadlocks, optimistic/pessimistic locking
Distributed Transactions — 2PC, 3PC, Saga pattern, TCC (Try-Confirm-Cancel)
Object Storage — S3-style blob storage, multipart uploads, lifecycle policies
CDN — edge caching, origin shield, cache invalidation strategies
Data Modeling — entity-relationship, access-pattern-driven design (for NoSQL)
3. Caching Strategies
Cache Layers — client, CDN, load balancer, application, distributed cache, database
Cache Patterns — Cache-Aside, Read-Through, Write-Through, Write-Behind, Write-Around
Eviction Policies — LRU, LFU, FIFO, TTL-based
Cache Invalidation — active vs. passive, cache warming
Cache Consistency — thundering herd problem, cache stampede, conditional GET
Distributed Caches — Redis, Memcached; clustering, partitioning, replication
Local vs. Remote Cache — Caffeine/Guava vs. Redis
4. Concurrency & Synchronization
Concurrency Models — threading, event loops, actor model, coroutines
Locks — mutex, semaphore, read-write locks, spinlocks, distributed locks
Lock-Free Structures — atomic operations, CAS (Compare-And-Swap), concurrent data structures
Deadlock Prevention — ordering, timeout, detection, avoidance (Banker's algorithm)
Race Conditions — data races, memory barriers, happens-before relationships
Thread Pools — fixed, cached, work-stealing; tuning core/max sizes, queue types
Actor Model — message passing, Akka-style isolation
Distributed Locks — Redis RedLock, Zookeeper, etcd, consensus-based locking
Idempotency — exactly-once semantics, deduplication keys, idempotency tokens
Optimistic vs. Pessimistic Concurrency — versioning, MVCC (Multi-Version Concurrency Control)
5. Communication & Messaging
Synchronous — REST, gRPC, GraphQL, tRPC
Asynchronous — message queues, event buses, pub/sub
Message Brokers — Kafka, RabbitMQ, SQS, Pulsar, NATS
Delivery Semantics — at-most-once, at-least-once, exactly-once
Message Ordering — partition keys, global ordering vs. per-partition ordering
Backpressure in Messaging — consumer lag, flow control, prefetch limits
Event Sourcing — event store, CQRS (Command Query Responsibility Segregation)
WebSockets — persistent connections, heartbeat, broadcast scaling
SSE (Server-Sent Events) — unidirectional streaming
Long Polling — vs. WebSockets, connection management
Service Discovery — client-side (Eureka) vs. server-side (Consul, Zookeeper, etcd)
6. Microservices & Architecture Patterns
Service Boundaries — DDD (Domain-Driven Design), bounded contexts
API Gateway — routing, auth, rate limiting, request/response transformation
Service Mesh — sidecar proxies (Envoy, Istio), mTLS, traffic splitting
Circuit Breaker — fail-fast, half-open state, bulkhead pattern
Bulkhead — resource isolation, thread pool segregation
Retry with Exponential Backoff & Jitter — transient failure handling
Timeout Strategies — cascading timeout budgets
Saga Pattern — choreography vs. orchestration for distributed transactions
Strangler Fig Pattern — incremental migration from monolith
CQRS — separating read and write models
Event Sourcing — immutable event log, state reconstruction
BFF (Backend for Frontend) — per-client optimized APIs
Sidecar Pattern — cross-cutting concerns (logging, monitoring, config)
7. Reliability & Fault Tolerance
SLA/SLO/SLI — defining and measuring reliability
Failover — active-passive, active-active, automatic vs. manual
Health Checks — liveness, readiness, startup probes
Graceful Degradation — feature toggles, fallback content, reduced functionality
Chaos Engineering — fault injection, GameDay exercises
Disaster Recovery — RPO (Recovery Point Objective), RTO (Recovery Time Objective)
Data Durability — WAL (Write-Ahead Logging), snapshots, backups, point-in-time recovery
Leader Election — consensus algorithms (Raft, Paxos, ZAB)
Byzantine Fault Tolerance — malicious node tolerance
Idempotency Keys — duplicate request handling
8. Security & Authentication
Authentication — OAuth 2.0, OpenID Connect, JWT, SAML, session cookies
Authorization — RBAC (Role-Based), ABAC (Attribute-Based), ACLs, policy engines
mTLS — service-to-service mutual authentication
Encryption — at-rest (AES, KMS) vs. in-transit (TLS 1.3)
Secrets Management — Vault, AWS Secrets Manager, environment isolation
API Security — throttling, input validation, SQL injection prevention, XSS/CSRF
Zero Trust Architecture — never trust, always verify
9. Data Processing & Analytics
Batch Processing — MapReduce, Spark, Hadoop
Stream Processing — Kafka Streams, Flink, Spark Streaming, Storm
Lambda Architecture — batch + speed layers
Kappa Architecture — unified streaming-only
Windowing — tumbling, sliding, session, global windows
ETL vs. ELT — extract-transform-load patterns
Data Warehousing — columnar stores, star/snowflake schemas
OLTP vs. OLAP — transactional vs. analytical workloads