package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type demoCustomer struct {
	Name, Email, Phone, Country string
	VIP                         int
}

type demoProduct struct {
	Name, SKU, Category, Status string
	Price                       float64
	Stock                       int
	ID                          int64
}

func SeedDemo(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	pool, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer pool.Close()
	pool.SetMaxOpenConns(1)
	if err := pool.Ping(); err != nil {
		return err
	}
	var existing int
	if err := pool.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='customers'`).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}

	schema := []string{
		`CREATE TABLE customers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT NOT NULL UNIQUE,
			phone TEXT,
			country TEXT NOT NULL DEFAULT '中国',
			vip INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			sku TEXT NOT NULL UNIQUE,
			category TEXT NOT NULL,
			price REAL NOT NULL DEFAULT 0,
			stock INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT '在售',
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			customer_id INTEGER NOT NULL,
			order_no TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL,
			total REAL NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (customer_id) REFERENCES customers(id)
		)`,
		`CREATE TABLE order_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_id INTEGER NOT NULL,
			product_id INTEGER NOT NULL,
			quantity INTEGER NOT NULL DEFAULT 1,
			unit_price REAL NOT NULL DEFAULT 0,
			FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id)
		)`,
		`CREATE TABLE employees (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			title TEXT NOT NULL,
			email TEXT NOT NULL UNIQUE,
			department TEXT NOT NULL,
			salary REAL NOT NULL,
			hired_at TEXT NOT NULL
		)`,
		`CREATE INDEX idx_customers_country ON customers(country)`,
		`CREATE INDEX idx_orders_customer ON orders(customer_id)`,
		`CREATE INDEX idx_orders_created ON orders(created_at)`,
		`CREATE INDEX idx_order_items_order ON order_items(order_id)`,
		`CREATE INDEX idx_order_items_product ON order_items(product_id)`,
		`CREATE VIEW v_order_summary AS
			SELECT o.id, o.order_no, c.name AS customer_name, c.country, o.status, o.total, o.created_at
			FROM orders o
			LEFT JOIN customers c ON c.id = o.customer_id`,
		`CREATE VIEW v_product_sales AS
			SELECT p.id, p.name, p.category, p.price,
			       COALESCE(SUM(oi.quantity), 0) AS sold_quantity,
			       COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS revenue
			FROM products p
			LEFT JOIN order_items oi ON oi.product_id = p.id
			GROUP BY p.id, p.name, p.category, p.price`,
	}
	for _, stmt := range schema {
		if _, err := pool.Exec(stmt); err != nil {
			return fmt.Errorf("创建示例表失败: %w", err)
		}
	}

	tx, err := pool.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now()
	customers := []demoCustomer{
		{"陈思远", "chen.siyuan@example.com", "13800001001", "中国", 1},
		{"林雨桐", "lin.yutong@example.com", "13800001002", "中国", 1},
		{"王浩然", "wang.haoran@example.com", "13800001003", "中国", 0},
		{"李若曦", "li.ruoxi@example.com", "13800001004", "中国", 1},
		{"张一鸣", "zhang.yiming@example.com", "13800001005", "中国", 0},
		{"刘子墨", "liu.zimo@example.com", "13800001006", "中国", 0},
		{"赵清扬", "zhao.qingyang@example.com", "13800001007", "中国", 1},
		{"周雨辰", "zhou.yuchen@example.com", "13800001008", "中国", 0},
		{"吴天泽", "wu.tianze@example.com", "13800001009", "新加坡", 1},
		{"郑晓彤", "zheng.xiaotong@example.com", "13800001010", "中国", 0},
		{"孙嘉宁", "sun.jianing@example.com", "13800001011", "中国", 0},
		{"马若男", "ma.ruonan@example.com", "13800001012", "美国", 1},
		{"朱宇航", "zhu.yuhang@example.com", "13800001013", "中国", 0},
		{"胡可欣", "hu.kexin@example.com", "13800001014", "中国", 1},
		{"郭明轩", "guo.mingxuan@example.com", "13800001015", "日本", 0},
		{"何静怡", "he.jingyi@example.com", "13800001016", "中国", 0},
		{"高子豪", "gao.zihao@example.com", "13800001017", "德国", 1},
		{"罗诗雅", "luo.shiya@example.com", "13800001018", "中国", 0},
		{"梁俊杰", "liang.junjie@example.com", "13800001019", "英国", 0},
		{"宋佳琪", "song.jiaqi@example.com", "13800001020", "中国", 1},
		{"唐子涵", "tang.zihan@example.com", "13800001021", "澳大利亚", 0},
		{"许晨曦", "xu.chenxi@example.com", "13800001022", "中国", 0},
		{"邓凯文", "deng.kaiwen@example.com", "13800001023", "加拿大", 1},
		{"曹梦瑶", "cao.mengyao@example.com", "13800001024", "中国", 0},
	}
	customerStmt, err := tx.Prepare(`INSERT INTO customers (name, email, phone, country, vip, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	for i, c := range customers {
		created := now.AddDate(0, 0, -200+i*5).Format("2006-01-02 15:04:05")
		if _, err := customerStmt.Exec(c.Name, c.Email, c.Phone, c.Country, c.VIP, created); err != nil {
			customerStmt.Close()
			return err
		}
	}
	customerStmt.Close()

	products := []demoProduct{
		{Name: "云服务器 ECS 标准型", SKU: "CLOUD-ECS-001", Category: "云计算", Price: 399.00, Stock: 120, Status: "在售"},
		{Name: "机械键盘 K87 Pro", SKU: "KB-087-PRO", Category: "外设", Price: 459.00, Stock: 86, Status: "在售"},
		{Name: "4K 显示器 27 英寸", SKU: "MON-4K-027", Category: "显示设备", Price: 1899.00, Stock: 34, Status: "在售"},
		{Name: "无线降噪耳机 Air Max", SKU: "AUDIO-ANC-01", Category: "音频", Price: 1299.00, Stock: 58, Status: "在售"},
		{Name: "智能手表 S9", SKU: "WATCH-S9-01", Category: "智能穿戴", Price: 1599.00, Stock: 42, Status: "在售"},
		{Name: "移动固态硬盘 2TB", SKU: "SSD-PORT-2T", Category: "存储", Price: 899.00, Stock: 73, Status: "在售"},
		{Name: "千兆路由器 AX3000", SKU: "NET-AX3000", Category: "网络", Price: 329.00, Stock: 110, Status: "在售"},
		{Name: "高清网络摄像头 4K", SKU: "CAM-4K-001", Category: "外设", Price: 399.00, Stock: 64, Status: "在售"},
		{Name: "20000mAh 充电宝", SKU: "PWR-20K-01", Category: "数码配件", Price: 159.00, Stock: 200, Status: "在售"},
		{Name: "蓝牙音箱 Mini", SKU: "AUDIO-SPK-1", Category: "音频", Price: 249.00, Stock: 0, Status: "缺货"},
		{Name: "人体工学办公椅", SKU: "CHAIR-ERG-1", Category: "办公", Price: 1299.00, Stock: 21, Status: "在售"},
		{Name: "显示器升降支架", SKU: "STAND-MON-1", Category: "办公", Price: 299.00, Stock: 47, Status: "在售"},
		{Name: "数据库系统课程（进阶）", SKU: "COURSE-DB-02", Category: "课程", Price: 599.00, Stock: 999, Status: "在售"},
		{Name: "RISC-V 开发板", SKU: "DEV-RV-001", Category: "硬件", Price: 699.00, Stock: 15, Status: "在售"},
		{Name: "USB-C 十一合一扩展坞", SKU: "DOCK-USBC-11", Category: "外设", Price: 349.00, Stock: 0, Status: "停售"},
	}
	productStmt, err := tx.Prepare(`INSERT INTO products (name, sku, category, price, stock, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	for i := range products {
		created := now.AddDate(0, 0, -120+i*3).Format("2006-01-02 15:04:05")
		res, err := productStmt.Exec(products[i].Name, products[i].SKU, products[i].Category, products[i].Price, products[i].Stock, products[i].Status, created)
		if err != nil {
			productStmt.Close()
			return err
		}
		products[i].ID, _ = res.LastInsertId()
	}
	productStmt.Close()

	statuses := []string{"已完成", "已完成", "已发货", "已付款", "已完成", "待付款", "已取消", "已完成"}
	orderStmt, err := tx.Prepare(`INSERT INTO orders (customer_id, order_no, status, total, created_at) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	itemStmt, err := tx.Prepare(`INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`)
	if err != nil {
		orderStmt.Close()
		return err
	}
	const orderCount = 48
	for i := 0; i < orderCount; i++ {
		created := now.AddDate(0, 0, -(i*7)%90).Add(-time.Duration((i*37)%24) * time.Hour)
		customerID := int64((i*7)%len(customers) + 1)
		itemCount := 1 + i%3
		var total float64
		orderNo := fmt.Sprintf("SO-%s-%04d", created.Format("2006"), 3101+i)
		res, err := orderStmt.Exec(customerID, orderNo, statuses[i%len(statuses)], 0, created.Format("2006-01-02 15:04:05"))
		if err != nil {
			orderStmt.Close()
			itemStmt.Close()
			return err
		}
		orderID, _ := res.LastInsertId()
		for k := 0; k < itemCount; k++ {
			product := products[(i*3+k*5)%len(products)]
			quantity := 1 + (i+k)%3
			total += product.Price * float64(quantity)
			if _, err := itemStmt.Exec(orderID, product.ID, quantity, product.Price); err != nil {
				orderStmt.Close()
				itemStmt.Close()
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE orders SET total = ? WHERE id = ?`, total, orderID); err != nil {
			orderStmt.Close()
			itemStmt.Close()
			return err
		}
	}
	orderStmt.Close()
	itemStmt.Close()

	employees := []struct {
		name, title, email, department string
		salary                         float64
		days                           int
	}{
		{"顾言", "技术总监", "gu.yan@navideck.dev", "研发中心", 42000, 900},
		{"沈心悦", "高级后端工程师", "shen.xinyue@navideck.dev", "研发中心", 28000, 650},
		{"陆之遥", "数据库管理员", "lu.zhiyao@navideck.dev", "基础架构", 26000, 540},
		{"白书宁", "产品经理", "bai.shuning@navideck.dev", "产品部", 25000, 480},
		{"秦朗", "前端工程师", "qin.lang@navideck.dev", "研发中心", 23000, 320},
		{"夏安然", "数据分析师", "xia.anran@navideck.dev", "数据平台", 22000, 260},
		{"孟繁星", "UI 设计师", "meng.fanxing@navideck.dev", "设计部", 20000, 210},
		{"韩彻", "测试工程师", "han.che@navideck.dev", "质量保障", 19000, 150},
	}
	empStmt, err := tx.Prepare(`INSERT INTO employees (name, title, email, department, salary, hired_at) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	for _, e := range employees {
		if _, err := empStmt.Exec(e.name, e.title, e.email, e.department, e.salary, now.AddDate(0, 0, -e.days).Format("2006-01-02")); err != nil {
			empStmt.Close()
			return err
		}
	}
	empStmt.Close()

	return tx.Commit()
}
