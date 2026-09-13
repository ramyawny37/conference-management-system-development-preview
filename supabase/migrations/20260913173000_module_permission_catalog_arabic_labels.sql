begin;

-- Presentation-only localization for the module permission administration UI.
-- Stable permission keys, scope rules, sensitivity, status, and authorization semantics are unchanged.

update public.module_permission_catalog as catalog
set display_name = labels.display_name,
    description = labels.description
from (values
  ('reservations','reservations.assignment.manage','إدارة إسناد الحجوزات','إسناد الموارد المؤهلة مع منع تعارض الحجوزات.'),
  ('reservations','reservations.attendance.manage','إدارة الحضور','تسجيل الحضور للفعاليات وتصحيحه.'),
  ('reservations','reservations.attendance.view','عرض الحضور','عرض سجلات حضور الفعاليات.'),
  ('reservations','reservations.booking.cancel','إلغاء الحجوزات','إلغاء الحجوزات المؤهلة سواء كانت مسودة أو مؤكدة.'),
  ('reservations','reservations.booking.create','إنشاء الحجوزات','إنشاء بيانات المشاركين وحجوزات الفعاليات.'),
  ('reservations','reservations.booking.delete','حذف الحجوزات غير المستخدمة','حذف الحجز فقط قبل وجود سجل مالي أو سجل حضور مرتبط به.'),
  ('reservations','reservations.booking.update','تعديل الحجوزات','تعديل بيانات المشاركين وتفاصيل الحجوزات.'),
  ('reservations','reservations.booking.view','عرض الحجوزات','عرض المشاركين والحجوزات التابعة للمؤسسة.'),
  ('reservations','reservations.event.manage','إدارة فعاليات الحجز','إنشاء وتعديل وحذف فعاليات وفترات وأنواع الحجز بشكل آمن.'),
  ('reservations','reservations.event.view','عرض فعاليات الحجز','عرض فعاليات الحجز وإعداداتها التابعة للمؤسسة.'),
  ('reservations','reservations.operations.manage','إدارة العمليات','استكمال المراجعات التشغيلية أو تصحيحها.'),
  ('reservations','reservations.operations.view','عرض العمليات','عرض بيانات المراجعة التشغيلية والجاهزية.'),
  ('reservations','reservations.payment.record','تسجيل المدفوعات','تسجيل دفعات الحجز في السجل المالي غير القابل للتعديل.'),
  ('reservations','reservations.payment.view','عرض المدفوعات','عرض سجل المدفوعات والأرصدة المحسوبة.'),
  ('reservations','reservations.payment.void','إلغاء المدفوعات','إلغاء دفعة مع الحفاظ على سجلها المالي.'),
  ('reservations','reservations.reports.view','عرض تقارير الحجوزات','عرض بيانات تقارير الحجوزات التابعة للمؤسسة.'),
  ('reservations','reservations.stay.check_in','تسجيل الوصول','تسجيل وصول حجز مؤكد تم إسناد مورد له.'),
  ('reservations','reservations.stay.check_out','تسجيل المغادرة','تسجيل مغادرة إقامة نشطة.'),
  ('warehouse','warehouse.import.stage','تجهيز استيراد بيانات المخازن','السماح بالتحقق من بيانات الاستيراد وتجهيزها فقط دون ترحيل حركات مخزنية.'),
  ('warehouse','warehouse.item.create','إنشاء الأصناف','إنشاء تصنيفات ووحدات وأصناف المخازن.'),
  ('warehouse','warehouse.item.update','تعديل الأصناف','تعديل أو إيقاف تصنيفات ووحدات وأصناف المخازن.'),
  ('warehouse','warehouse.item.view','عرض الأصناف','عرض تصنيفات ووحدات وأصناف المخازن.'),
  ('warehouse','warehouse.party.manage','إدارة الموردين والمستفيدين','إنشاء وتعديل بيانات الموردين والمستفيدين.'),
  ('warehouse','warehouse.party.view','عرض الموردين والمستفيدين','عرض بيانات الموردين والمستفيدين.'),
  ('warehouse','warehouse.reports.export','تصدير تقارير المخازن','السماح بتصدير تقرير مخزون داخل النطاق الممنوح.'),
  ('warehouse','warehouse.reports.view','عرض تقارير المخازن','عرض تقارير المخزون داخل النطاق الممنوح.'),
  ('warehouse','warehouse.stock.adjust','تسوية المخزون','إنشاء طلبات الرصيد الافتتاحي والتسوية والتالف والفاقد والتصحيح والعكس.'),
  ('warehouse','warehouse.stock.approve','اعتماد تغييرات المخزون','اعتماد تسويات المخزون وعمليات العكس الخاضعة للرقابة.'),
  ('warehouse','warehouse.stock.issue','صرف المخزون','إنشاء وتعديل مستندات الصرف الخاصة بالمخزن.'),
  ('warehouse','warehouse.stock.post','ترحيل حركات المخزون','ترحيل مستندات المخزون أو عكسها في السجل غير القابل للتعديل.'),
  ('warehouse','warehouse.stock.receive','استلام المخزون','إنشاء وتعديل مستندات الاستلام الخاصة بالمخزن.'),
  ('warehouse','warehouse.stock.transfer','تحويل المخزون','إنشاء وتعديل التحويلات مع اشتراط الصلاحية على المخزنين.'),
  ('warehouse','warehouse.store.create','إنشاء المخازن','إنشاء مخزن جديد.'),
  ('warehouse','warehouse.store.update','تعديل المخازن','تعديل مخزن أو إيقافه.'),
  ('warehouse','warehouse.store.view','عرض المخازن','عرض المخازن داخل النطاق الممنوح.')
) as labels(module_key, permission_key, display_name, description)
where catalog.module_key = labels.module_key
  and catalog.permission_key = labels.permission_key;

commit;
