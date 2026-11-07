package db

import (
	"strings"
	"testing"

	"navideck/backend/internal/model"
)

func TestBuildDSNNewDrivers(t *testing.T) {
	manager := NewManager(t.TempDir())

	t.Run("mariadb uses mysql driver", func(t *testing.T) {
		dsn, driver, err := manager.buildDSN(model.Connection{
			Driver:   model.DriverMariaDB,
			Host:     "db.local",
			Port:     3306,
			Username: "app",
			SSLMode:  "disable",
		}, "secret", "shop")
		if err != nil {
			t.Fatal(err)
		}
		if driver != "mysql" {
			t.Fatalf("driver = %q, want mysql", driver)
		}
		if !strings.Contains(dsn, "tcp(db.local:3306)") || !strings.Contains(dsn, "/shop") {
			t.Fatalf("unexpected mariadb DSN: %s", dsn)
		}
	})

	t.Run("sqlserver encrypt and instance", func(t *testing.T) {
		dsn, driver, err := manager.buildDSN(model.Connection{
			Driver:   model.DriverSQLServer,
			Host:     "sql.local",
			Port:     1433,
			Username: "sa",
			Instance: "SQLEXPRESS",
			SSLMode:  "require",
		}, "secret", "master")
		if err != nil {
			t.Fatal(err)
		}
		if driver != "sqlserver" {
			t.Fatalf("driver = %q, want sqlserver", driver)
		}
		for _, want := range []string{"sqlserver://sa:secret@sql.local:1433/SQLEXPRESS", "database=master", "encrypt=true", "trustservercertificate=true"} {
			if !strings.Contains(dsn, want) {
				t.Fatalf("DSN missing %q: %s", want, dsn)
			}
		}
	})

	t.Run("oracle service with wallet", func(t *testing.T) {
		dsn, driver, err := manager.buildDSN(model.Connection{
			Driver:       model.DriverOracle,
			Host:         "oracle.local",
			Port:         1521,
			Username:     "system",
			Database:     "ORCLPDB1",
			SSLMode:      "require",
			OracleWallet: "/opt/oracle/wallet",
		}, "secret", "ORCLPDB1")
		if err != nil {
			t.Fatal(err)
		}
		if driver != "oracle" {
			t.Fatalf("driver = %q, want oracle", driver)
		}
		for _, want := range []string{"oracle://system:secret@oracle.local:1521/ORCLPDB1", "ssl=true", "wallet=%2Fopt%2Foracle%2Fwallet"} {
			if !strings.Contains(dsn, want) {
				t.Fatalf("DSN missing %q: %s", want, dsn)
			}
		}
	})

	t.Run("oracle sid", func(t *testing.T) {
		dsn, _, err := manager.buildDSN(model.Connection{
			Driver:    model.DriverOracle,
			Host:      "oracle.local",
			Port:      1521,
			Username:  "scott",
			OracleSID: "ORCL",
		}, "tiger", "")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(dsn, "sid=ORCL") || strings.Contains(dsn, "/ORCL?") {
			t.Fatalf("unexpected oracle SID DSN: %s", dsn)
		}
	})
}

func TestNewDriverIdentifiers(t *testing.T) {
	if got := quoteIdent(model.DriverSQLServer, "order]items"); got != "[order]]items]" {
		t.Fatalf("sqlserver quoteIdent = %q", got)
	}
	if got := qualifiedTable(model.DriverOracle, "ORCL", "SCOTT", "EMP"); got != `"SCOTT"."EMP"` {
		t.Fatalf("oracle qualifiedTable = %q", got)
	}
	if got := qualifiedTable(model.DriverSQLServer, "shop", "dbo", "orders"); got != "[dbo].[orders]" {
		t.Fatalf("sqlserver qualifiedTable = %q", got)
	}
	if got := qualifiedTable(model.DriverMariaDB, "shop", "shop", "orders"); got != "`shop`.`orders`" {
		t.Fatalf("mariadb qualifiedTable = %q", got)
	}
	if got := qualifiedTable(model.DriverSnowflake, "WAREHOUSE", "PUBLIC", "ORDERS"); got != `"PUBLIC"."ORDERS"` {
		t.Fatalf("snowflake qualifiedTable = %q", got)
	}
}

func TestSnowflakeMongoRedisOptions(t *testing.T) {
	manager := NewManager(t.TempDir())

	dsn, driver, err := manager.buildDSN(model.Connection{
		Driver:        model.DriverSnowflake,
		Account:       "ab12345.ap-southeast-1",
		Username:      "navideck",
		Warehouse:     "COMPUTE_WH",
		Role:          "SYSADMIN",
		DefaultSchema: "PUBLIC",
	}, "secret", "ANALYTICS")
	if err != nil {
		t.Fatal(err)
	}
	if driver != "snowflake" || dsn == "" || !strings.Contains(dsn, "ab12345.ap-southeast-1") {
		t.Fatalf("unexpected snowflake DSN: driver=%s dsn=%s", driver, dsn)
	}

	mongoURI, err := manager.mongoURI(model.Connection{
		Driver:     model.DriverMongo,
		Host:       "mongo.local",
		Port:       27017,
		Username:   "app",
		Database:   "shop",
		AuthSource: "admin",
		SSLMode:    "require",
	}, "secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"mongodb://app:secret@mongo.local:27017/shop", "authSource=admin", "tls=true"} {
		if !strings.Contains(mongoURI, want) {
			t.Fatalf("mongo URI missing %q: %s", want, mongoURI)
		}
	}

	redisOptions := manager.redisOptions(model.Connection{
		Driver:   model.DriverRedis,
		Host:     "redis.local",
		Port:     6379,
		Username: "user",
		SSLMode:  "verify-full",
	}, "secret", "3")
	if redisOptions.DB != 3 || redisOptions.Addr != "redis.local:6379" || redisOptions.TLSConfig == nil || redisOptions.TLSConfig.InsecureSkipVerify {
		t.Fatalf("unexpected redis options: %+v", redisOptions)
	}
}
